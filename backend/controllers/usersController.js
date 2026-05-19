const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const UserModel = require('../models/userModel')

const userController = {
    async signup(req, res, next) {
        try {
            const { username, email, password} = req.body;
            const password_has = await bcrypt.hash(password, 10);
            const user = await UserModel.createUser({ username, email, password_hash });
            res.status(201).json({ user })
        }catch (err) {
             next(err)
        }
    },

    async login(req, res, next) {
        try {
            const { email, password } = req.body
            const user = await UserModel.getUserByEmail(email);

            if(!user){
                return res.status(401).json({ error: "Credenciales invalidas" });
            }
            const password_success = await bcrypt.compare(password, user.password_hash)
            if (password_success == false) {
                return res.status(401).json({ error: "Credenciales invalidas" });
            }

            const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' })

            res.json({ token, user: { id: user.id, username: user.username, email: user.email } })
        }catch(err){
            next(err)
        }
    },

    async getMe(req, res, next) {
        try {
            const user = await UserModel.getUserById(req.user.id)
            res.json({ user })
        }catch(err){
            next(err)
        }
    }
}

module.exports = userController;
