// Signs release files the way OpenWrt's usign checks them (signify's Ed25519 format), so a
// router can tell a real release from anything else before installing it.
//   node tools/release/sign.mjs keygen <path>     writes <path>.pub and <path>.sec (no passphrase)
//   ZEELI_SIGNING_KEY="$(cat <path>.sec)" node tools/release/sign.mjs <file>   writes <file>.sig
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const keyFile = (comment, ...parts) => `untrusted comment: ${comment}\n${Buffer.concat(parts).toString('base64')}\n`;
const [command, path] = process.argv.slice(2);

if (command === 'keygen') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const keynum = randomBytes(8);
  const secret = Buffer.concat([seed, pub]);
  const checksum = createHash('sha512').update(secret).digest().subarray(0, 8);
  writeFileSync(`${path}.pub`, keyFile('Zeeli Controller release key', Buffer.from('Ed'), keynum, pub));
  // pkalg, kdfalg, 0 kdf rounds (no passphrase), salt, checksum, key number, key
  const sec = keyFile(
    'Zeeli Controller release secret key',
    Buffer.from('EdBK'),
    Buffer.alloc(4),
    randomBytes(16),
    checksum,
    keynum,
    secret,
  );
  writeFileSync(`${path}.sec`, sec, { mode: 0o600 });
} else {
  const raw = Buffer.from((process.env.ZEELI_SIGNING_KEY ?? '').trim().split('\n').pop(), 'base64');
  if (raw.length !== 104) throw new Error('ZEELI_SIGNING_KEY isn’t a signify secret key.');
  const keynum = raw.subarray(32, 40);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.subarray(40, 72)]);
  const signature = sign(null, readFileSync(command), createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }));
  writeFileSync(`${command}.sig`, keyFile(`signed by key ${keynum.toString('hex')}`, Buffer.from('Ed'), keynum, signature));
}
