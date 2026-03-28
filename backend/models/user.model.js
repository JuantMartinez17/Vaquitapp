const pool = require('../config/db_connection');


// GET
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

// POST

const createUser = async (username, email, passwordHash) => {
    const res = await pool.query("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at", [username, email, passwordHash]);
    return res.rows[0]
}


// PATCH 

const updateUser = async (id, fields) => {
    const keys = Object.keys(fields) //keys = ['username', 'email', 'passwordHash']
    const setClauses = keys.map((key, index) => `${key} = $${index + 1}`) //setClauses = ['username = $1']
    const setString = setClauses.join(', ') //setString = ['username = $1', 'email = $2']
    const values = Object.values(fields)

    const res = await pool.query(`UPDATE users SET ${setString} WHERE id = $${keys.length + 1}`, [...values, id])
    return res.rows[0]
}

// DELETE 

const deleteUser = async (id) => {
    const res = await pool.query("DELETE FROM users WHERE id = $1", [id])
    return res.rows[0]
}

module.exports = {
    getAllUsers,
    getUserById,
    getUserByEmail,
    getUserByUsername,
    createUser,
    updateUser,
    deleteUser
}


