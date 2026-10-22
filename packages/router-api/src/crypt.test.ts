import { expect, test } from 'vitest';
import { shaCrypt } from './crypt.ts';

// Expected values from `openssl passwd -5 -salt <salt> <password>`.
test('sha256 crypt matches openssl', async () => {
  expect(await shaCrypt('Hello world!', '$5$saltstring')).toBe('$5$saltstring$5B8vYYiY.CVt1RlTTf8KbXBH3hsxY/GNooZaBBGWEc5');
  expect(await shaCrypt('Hello world!', '$5$saltstringsaltstring$')).toBe(
    '$5$saltstringsaltst$a5C8Ofk71MUIoKve2QuP9FMl.dwNgseF5tR1LGAL7iB',
  );
});
