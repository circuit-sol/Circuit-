// COPY AND RUN IN TERMINAL TO GET A TEST WALLET AND WALLET ADDRESS

node -e "const fs=require('node:fs'); const {Keypair}=require('@solana/web3.js'); const k=Keypair.generate(); fs.writeFileSync('.test-wallet.json',JSON.stringify(Array.from(k.secretKey)),{flag:'wx',mode:0o600}); console.log('Wallet address:',k.publicKey.toBase58());"