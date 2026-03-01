import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hexToBytes, bytesToHex } from '../../lib/crypto/utils.js';
import { schnorrSign, schnorrVerify } from '../../lib/crypto/schnorr.js';

interface TestVector {
  index: number;
  seckey: string | null;
  pubkey: string;
  auxrand?: string;
  msg: string;
  sig: string;
  verify: boolean;
}

// BIP-340 official test vectors (from CSV)
// Source: https://github.com/bitcoin/bips/blob/master/bip-0340/test-vectors.csv
const vectors: TestVector[] = [
  {
    index: 0,
    seckey: '0000000000000000000000000000000000000000000000000000000000000003',
    pubkey: 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
    auxrand: '0000000000000000000000000000000000000000000000000000000000000000',
    msg: '0000000000000000000000000000000000000000000000000000000000000000',
    sig: 'e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0',
    verify: true,
  },
  {
    index: 1,
    seckey: 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef',
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    auxrand: '0000000000000000000000000000000000000000000000000000000000000001',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '6896bd60eeae296db48a229ff71dfe071bde413e6d43f917dc8dcf8c78de33418906d11ac976abccb20b091292bff4ea897efcb639ea871cfa95f6de339e4b0a',
    verify: true,
  },
  {
    index: 2,
    seckey: 'c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9',
    pubkey: 'dd308afec5777e13121fa72b9cc1b7cc0139715309b086c960e18fd969774eb8',
    auxrand: 'c87aa53824b4d7ae2eb035a2b5bbbccc080e76cdc6d1692c4b0b62d798e6d906',
    msg: '7e2d58d8b3bcdf1abadec7829054f90dda9805aab56c77333024b9d0a508b75c',
    sig: '5831aaeed7b44bb74e5eab94ba9d4294c49bcf2a60728d8b4c200f50dd313c1bab745879a5ad954a72c45a91c3a51d3c7adea98d82f8481e0e1e03674a6f3fb7',
    verify: true,
  },
  {
    index: 3,
    seckey: '0b432b2677937381aef05bb02a66ecd012773062cf3fa2549e44f58ed2401710',
    pubkey: '25d1dff95105f5253c4022f628a996ad3a0d95fbf21d468a1b33f8c160d8f517',
    auxrand: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    msg: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    sig: '7eb0509757e246f19449885651611cb965ecc1a187dd51b64fda1edc9637d5ec97582b9cb13db3933705b32ba982af5af25fd78881ebb32771fc5922efc66ea3',
    verify: true,
  },
  // Vectors 4-14: verify-only (no seckey)
  {
    index: 4,
    seckey: null,
    pubkey: 'd69c3509bb99e412e68b0fe8544e72837dfa30746d8be2aa65975f29d22dc7b9',
    msg: '4df3c3f68fcc83b27e9d42c90431a72499f17875c81a599b566c9889b9696703',
    sig: '00000000000000000000003b78ce563f89a0ed9414f5aa28ad0d96d6795f9c6376afb1548af603b3eb45c9f8207dee1060cb71c04e80f593060b07d28308d7f4',
    verify: true,
  },
  {
    index: 5,
    seckey: null,
    pubkey: 'eefdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '6cff5c3ba86c69ea4b7376f31a9bcb4f74c1976089b2d9963da2e5543e17776969e89b4c5564d00349106b8497785dd7d1d713a8ae82b32fa79d5f7fc407d39b',
    verify: false,  // public key not on curve
  },
  {
    index: 6,
    seckey: null,
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: 'fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a14602975563cc27944640ac607cd107ae10923d9ef7a73c643e166be5ebeafa34b1ac553e2',
    verify: false,  // has_even_y(R) is false
  },
  {
    index: 7,
    seckey: null,
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '1fa62e331edbc21c394792d2ab1100a7b432b013df3f6ff4f99fcb33e0e1515f28890b3edb6e7189b630448b515ce4f8622a954cfe545735aaea5134fccdb2bd',
    verify: false,  // negated message
  },
  {
    index: 8,
    seckey: null,
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '6cff5c3ba86c69ea4b7376f31a9bcb4f74c1976089b2d9963da2e5543e177769961764b3aa9b2ffcb6ef947b6887a226e8d7c93e00c5ed0c1834ff0d0c2e6da6',
    verify: false,  // negated s value
  },
  {
    index: 9,
    seckey: null,
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '0000000000000000000000000000000000000000000000000000000000000000123dda8328af9c23a94c1feecfd123ba4fb73476f0d594dcb65c6425bd186051',
    verify: false,  // sG - eP is infinite
  },
  {
    index: 10,
    seckey: null,
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '00000000000000000000000000000000000000000000000000000000000000017615fbaf5ae28864013c099742deadb4dba87f11ac6754f93780d5a1837cf197',
    verify: false,  // sG - eP is infinite
  },
  {
    index: 11,
    seckey: null,
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '4a298dacae57395a15d0795ddbfd1dcb564da82b0f269bc70a74f8220429ba1d69e89b4c5564d00349106b8497785dd7d1d713a8ae82b32fa79d5f7fc407d39b',
    verify: false,  // sig[0:32] not on curve
  },
  {
    index: 12,
    seckey: null,
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f69e89b4c5564d00349106b8497785dd7d1d713a8ae82b32fa79d5f7fc407d39b',
    verify: false,  // sig[0:32] >= p
  },
  {
    index: 13,
    seckey: null,
    pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '6cff5c3ba86c69ea4b7376f31a9bcb4f74c1976089b2d9963da2e5543e177769fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
    verify: false,  // sig[32:64] >= n
  },
  {
    index: 14,
    seckey: null,
    pubkey: 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc30',
    msg: '243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89',
    sig: '6cff5c3ba86c69ea4b7376f31a9bcb4f74c1976089b2d9963da2e5543e17776969e89b4c5564d00349106b8497785dd7d1d713a8ae82b32fa79d5f7fc407d39b',
    verify: false,  // pubkey exceeds field size
  },
];

describe('BIP-340 Schnorr test vectors', () => {
  for (const v of vectors) {
    if (v.seckey) {
      it(`vector ${v.index}: sign produces correct signature`, async () => {
        const msg = hexToBytes(v.msg);
        const seckey = hexToBytes(v.seckey!);
        const auxrand = hexToBytes(v.auxrand!);
        const sig = await schnorrSign(msg, seckey, auxrand);
        assert.strictEqual(bytesToHex(sig), v.sig);
      });
    }

    it(`vector ${v.index}: verify returns ${v.verify}`, async () => {
      const msg = hexToBytes(v.msg);
      const pubkey = hexToBytes(v.pubkey);
      const sig = hexToBytes(v.sig);
      const result = await schnorrVerify(msg, pubkey, sig);
      assert.strictEqual(result, v.verify);
    });
  }
});

describe('schnorr additional tests', () => {
  it('verify rejects tampered signature', async () => {
    const seckey = hexToBytes(vectors[0].seckey!);
    const msg = hexToBytes(vectors[0].msg);
    const auxrand = hexToBytes(vectors[0].auxrand!);
    const sig = await schnorrSign(msg, seckey, auxrand);

    // Tamper with last byte
    sig[63] ^= 0x01;
    const pubkey = hexToBytes(vectors[0].pubkey);
    const result = await schnorrVerify(msg, pubkey, sig);
    assert.strictEqual(result, false);
  });
});
