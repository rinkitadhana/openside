const generateRoomId = (): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";

  const randomString = (length: number) => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);

    return Array.from(bytes)
      .map((value) => alphabet[value % alphabet.length])
      .join("");
  };

  return `${randomString(3)}-${randomString(4)}-${randomString(3)}`;
};

export default generateRoomId;
