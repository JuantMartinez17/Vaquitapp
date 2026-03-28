//Middleware to handle basic postgreSql errors

module.exports = (err, req, res, next) => {
    console.error("Error: ", err);

    if(err.code === '23505') { // Unique violation error code
        return res.status(400).json({ error: 'Duplicate entry. The value already exists.' });
    }
    
    res.status(500).json({error: 'Internal Server Error' });
}