const credentials = require('./credentials');
const { createCipheriv, randomBytes, createDecipheriv } = require('crypto');

const key = credentials.keys.key;
const iv = credentials.keys.iv;

const decryptLoginData = (encryptedPassword) => {
    const decipher = createDecipheriv('aes256', key, iv);
    return decipher.update(encryptedPassword, 'hex', 'utf-8') + decipher.final('utf8');
};

module.exports = { decryptLoginData };