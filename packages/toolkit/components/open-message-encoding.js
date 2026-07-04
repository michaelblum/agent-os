function utf8BinaryString(input) {
  if (typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return binary;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('binary');
  }
  throw new Error('UTF-8 encoder unavailable');
}

export function encodeOpenMessageBase64(message) {
  const json = JSON.stringify(message);
  if (typeof btoa === 'function') {
    return btoa(utf8BinaryString(json));
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64');
  }
  throw new Error('base64 encoder unavailable');
}
