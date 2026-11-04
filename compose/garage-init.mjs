// One-shot setup for the Garage object store (compose service `storage-init`).
// Idempotent: safe to run on every `docker compose up`. Exits non-zero on any
// failure, so the app service (which waits for this to complete successfully)
// never starts against a half-configured store.
//
// Uses only Garage's admin API v2 (bearer token): node layout, access key,
// bucket, key permissions, and the bucket CORS rule that browser uploads need
// (docs/prd.md §20).

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`storage-init: ${name} is not set`);
  return value;
};

const ADMIN_URL = env("GARAGE_ADMIN_URL");
const ADMIN_TOKEN = env("GARAGE_ADMIN_TOKEN");
const BUCKET = env("BUCKET_NAME");
const KEY_ID = env("AWS_ACCESS_KEY_ID");
const KEY_SECRET = env("AWS_SECRET_ACCESS_KEY");
// The browser origin allowed to PUT/GET through presigned URLs.
const APP_ORIGIN = new URL(env("APP_URL")).origin;

// Layout capacity only weights data placement between nodes; with one node it
// has no practical effect and is not a quota.
const NODE_CAPACITY_BYTES = 100 * 1024 ** 3;

async function admin(method, path, body) {
  const res = await fetch(`${ADMIN_URL}/v2/${path}`, {
    method,
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, data: text ? JSON.parse(text) : null };
}

async function must(method, path, body) {
  const res = await admin(method, path, body);
  if (!res.ok) throw new Error(`storage-init: ${method} ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

async function waitForGarage() {
  for (let attempt = 1; attempt <= 60; attempt++) {
    let res;
    try {
      res = await admin("GET", "GetClusterStatus");
    } catch {
      // Not listening yet: retry.
    }
    if (res?.ok) return res.data;
    // A refused token will not fix itself by waiting.
    if (res && (res.status === 401 || res.status === 403)) {
      throw new Error(`storage-init: Garage refused GARAGE_ADMIN_TOKEN (${res.status}); check it matches the garage service`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`storage-init: Garage admin API at ${ADMIN_URL} did not answer within 60 s`);
}

async function ensureLayout(status) {
  const [node] = status.nodes;
  if (!node) throw new Error("storage-init: Garage reports no nodes");
  if (node.role) return;
  await must("POST", "UpdateClusterLayout", {
    roles: [{ id: node.id, zone: "dc1", capacity: NODE_CAPACITY_BYTES, tags: [] }],
  });
  const layout = await must("GET", "GetClusterLayout");
  await must("POST", "ApplyClusterLayout", { version: layout.version + 1 });
  console.log(`storage-init: layout applied for node ${node.id.slice(0, 16)}`);
}

async function ensureKey() {
  const existing = await admin("GET", `GetKeyInfo?id=${encodeURIComponent(KEY_ID)}`);
  if (existing.ok) return;
  await must("POST", "ImportKey", { accessKeyId: KEY_ID, secretAccessKey: KEY_SECRET, name: "sandbucket-app" });
  console.log("storage-init: access key imported");
}

async function ensureBucket() {
  const existing = await admin("GET", `GetBucketInfo?globalAlias=${encodeURIComponent(BUCKET)}`);
  if (existing.ok) return existing.data.id;
  const created = await must("POST", "CreateBucket", { globalAlias: BUCKET });
  console.log(`storage-init: bucket ${BUCKET} created`);
  return created.id;
}

const status = await waitForGarage();
await ensureLayout(status);
await ensureKey();
const bucketId = await ensureBucket();

// The app only reads and writes objects; it never needs to change bucket settings.
await must("POST", "AllowBucketKey", {
  bucketId,
  accessKeyId: KEY_ID,
  permissions: { read: true, write: true, owner: false },
});

// Rewritten on every run so a changed app URL takes effect.
await must("POST", `UpdateBucket?id=${encodeURIComponent(bucketId)}`, {
  corsRules: [
    {
      AllowedOrigin: [APP_ORIGIN],
      AllowedMethod: ["GET", "PUT"],
      AllowedHeader: ["content-type"],
    },
  ],
});

console.log(`storage-init: ready (bucket ${BUCKET}, CORS origin ${APP_ORIGIN})`);
