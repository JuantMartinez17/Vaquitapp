const { pool } = require('pg');
require('dotenv').config();

const pool = new pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

try {
  await pool.connect();
  console.log("Connected to database successfully");
}catch (err) {
  console.error("Error connecting to database: ", err);
} finally {
  await pool.end();
}

module.exports = pool;
