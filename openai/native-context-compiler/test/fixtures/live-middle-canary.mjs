#!/usr/bin/env node

const marker = 'NCC_HIDDEN_CANARY_7F3C91A6B42E';

for (let index = 0; index < 600; index += 1) {
  if (index === 300) console.log(marker);
  else console.log(`archived-detail-${index.toString().padStart(4, '0')}`);
}
