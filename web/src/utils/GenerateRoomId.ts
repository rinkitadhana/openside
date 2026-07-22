const generateRoomId = (): string => {
  // Mirrors the server's generateJoinCode: 5 chars, uppercase letters + digits
  // with every visually confusable character removed (0/O, 1/I/L, 5/S, 2/Z,
  // 8/B, 6/G, U/V, D/Q). 25 characters remain.
  const alphabet = "ABCDEFGHJKMNPRTUWXY234579";
  const length = 5;
  // 25 doesn't divide 256, so reject bytes >= 250 (largest multiple of 25) to
  // avoid modulo bias; every character stays equally likely.
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let code = "";

  while (code.length < length) {
    const bytes = new Uint8Array(1);
    crypto.getRandomValues(bytes);
    const byte = bytes[0];
    if (byte >= max) continue;
    code += alphabet.charAt(byte % alphabet.length);
  }

  return code;
};

export default generateRoomId;
