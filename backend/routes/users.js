const router = require('express').Router();
const userController = require('../controllers/usersController')
const auth = require('../middlewares/auth')

router.post('/signup', userController.signup)
router.post('/login', userController.login)
router.get('/me', userController.getMe)