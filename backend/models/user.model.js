const pool = require('../config/db_connection');


// GET OPERATIONS
const getAllUsers = async () => {
   const res = await pool.query("SELECT id, username, email FROM users");
   return res.rows
}

const getUserById = async (id) => {
    const res = await pool.query("SELECT id, username, email FROM users WHERE id = $1", [id]);
    return res.rows[0]
}

const getUserByEmail = async (email) => {
    const res = await pool.query("SELECT id, username, email FROM users WHERE email = $1", [email]);
    return res.rows[0]
}

const getUserByUsername = async (username) => {
    const res = await pool.query("SELECT id, username, email FROM users WHERE username = $1", [username])
    return res.rows[0]
}



