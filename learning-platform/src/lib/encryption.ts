import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-byte-key-for-development!!';
const IV_LENGTH = 16; // AES block size

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  cipher.setEncoding('hex');
  cipher.write(text);
  cipher.end();

  const encrypted = cipher.read();
  return iv.toString('hex') + ':' + encrypted;
}

export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
  decipher.setEncoding('utf8');
  decipher.write(encrypted, 'hex');
  decipher.end();

  return decipher.read();
}