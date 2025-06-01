const CryptoJS = require('crypto-js');

const ENCRYPTION_KEY = process.env.PIN_ENCRYPTION_KEY || 'your-secret-encryption-key-32chr';

const encrypt = (text) => {
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
};

const decrypt = (encryptedText) => {
    const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
};

module.exports = {
    encrypt,
    decrypt
};