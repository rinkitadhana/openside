import crypto from "crypto";

const generateRoomId = (): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  
  const randomString = (length: number) =>
    Array.from(crypto.randomFillSync(new Uint8Array(length)))
      .map((n) => alphabet[n % alphabet.length])
      .join("");

  return `${randomString(3)}-${randomString(4)}-${randomString(3)}`;
};

export default generateRoomId;
