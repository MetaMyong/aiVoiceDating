#!/usr/bin/env node
const path = require('path');
const { startServer } = require('./server');

const PORT = process.env.PORT || 3000;

(async function(){
  try{
    await startServer(PORT);
    console.log('Server-only mode: listening on port', PORT);
  }catch(e){
    console.error('Failed to start server-only:', e);
    process.exit(1);
  }
  // keep process alive
  process.on('uncaughtException', (err)=>{ console.error('uncaughtException', err); });
  process.on('unhandledRejection', (r)=>{ console.error('unhandledRejection', r); });
  await new Promise(()=>{});
})();
