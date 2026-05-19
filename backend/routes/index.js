const router = require('express').Router();

router.use('/users', require('./usersRoutes'));


module.exports = router;