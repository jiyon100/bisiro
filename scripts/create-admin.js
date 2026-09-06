// Usage: node scripts/create-admin.js admin@bisiro.ph yourpassword
require('dotenv').config();
const crypto = require('crypto');
const pool   = require('../src/db/pool');

async function main() {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error('Usage: node scripts/create-admin.js <email> <password>');
    process.exit(1);
  }

  const hash = crypto.createHash('sha256').update(password).digest('hex');

  await pool.query(
    `INSERT INTO admin_users (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = $2`,
    [email, hash]
  );

  console.log(`Admin user created/updated: ${email}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
