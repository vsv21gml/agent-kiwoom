const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

async function main() {
  const envPath = path.join(__dirname, "..", ".env");
  const env = parseEnvFile(envPath);

  const client = new Client({
    host: env.DB_HOST || "localhost",
    port: Number(env.DB_PORT || "5432"),
    user: env.DB_USER || "postgres",
    password: env.DB_PASSWORD || "",
    database: env.DB_NAME || "postgres",
    ssl: env.DB_SSL === "true"
      ? { rejectUnauthorized: env.DB_SSL_IGNORE !== "true" }
      : false,
  });

  await client.connect();

  const before = await client.query(
    'SELECT COUNT(*)::int AS count FROM trade_logs WHERE "totalAmount" < 0 OR price < 0;',
  );
  const beforeCount = before.rows[0]?.count ?? 0;

  const update = await client.query(
    'UPDATE trade_logs SET price = ABS(price), "totalAmount" = ABS("totalAmount") WHERE "totalAmount" < 0 OR price < 0;',
  );

  const after = await client.query(
    'SELECT COUNT(*)::int AS count FROM trade_logs WHERE "totalAmount" < 0 OR price < 0;',
  );
  const afterCount = after.rows[0]?.count ?? 0;

  console.log(`Fixed rows: ${update.rowCount}`);
  console.log(`Remaining negative rows: ${afterCount}`);
  if (beforeCount > 0 && update.rowCount === 0) {
    console.log("Warning: No rows updated. Check column names or database connection.");
  }

  await client.end();
}

main().catch((error) => {
  console.error("Failed to fix trade logs:", error);
  process.exit(1);
});
