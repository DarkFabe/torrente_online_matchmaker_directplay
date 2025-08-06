try {
  const dgram = require('dgram');
  const server = dgram.createSocket('udp4');
  const ManagerParty = require('./classes/manager_party');
  const manager_party = new ManagerParty();

  const fs = require('fs');

  // Gunner: opcional - Cambia el archivo gunner.js de nombre o quitalo para no usar.
  let usarGunner = false;
  let obtenerPartidasDesdeWeb = () => {};
  try {
    ({ obtenerPartidasDesdeWeb } = require('./gunner'));
    usarGunner = true;
    console.log('🌐 Modo GUNNER activado');
  } catch {
    console.warn('⚠️ gunner.js no encontrado.');
  }

  const SAVE_FILE = './save.log';

  function importarArrayDesdeArchivo() {
    if (!fs.existsSync(SAVE_FILE)) {
      fs.writeFileSync(SAVE_FILE, '[]', 'utf-8');
      console.log(`⚠️ Creado ${SAVE_FILE}`);
      return [];
    }
    try {
      const contenido = fs.readFileSync(SAVE_FILE, 'utf-8');
      return JSON.parse(contenido).map(i => ({
        ip: i.ip,
        port: i.port,
        payload: Buffer.from(i.payload, 'hex'),
      }));
    } catch (err) {
      console.error('❌ Error al leer save.log:', err.message);
      return [];
    }
  }

  function exportarArrayAArchivo(arr) {
    const clones = arr.map(i => ({
      ip: i.ip,
      port: i.port,
      payload: i.payload.toString('hex'),
    }));
    fs.writeFileSync(SAVE_FILE, JSON.stringify(clones, null, 2), 'utf-8');
    console.log(`✅ Guardado en ${SAVE_FILE}`);
  }

  // Cargamos partidas guardadas
  const partidasGuardadas = importarArrayDesdeArchivo();
  partidasGuardadas.forEach(p => {
    manager_party.add_member(p.ip, p.port, p.payload, true);
  });

  // Si está Gunner se ejecuta
  if (usarGunner) {
    setInterval(() => {
      obtenerPartidasDesdeWeb(manager_party);
    }, 1000 * 20);
    obtenerPartidasDesdeWeb(manager_party);
  }

  // Procesamiento de mensajes UDP
  function replaceBinaryIp(buffer, newIpStr, newPort) {
    console.log(`remplaza ip. Buffer antiguo: ${buffer.toString('hex')}`);

    const BYTE_SEPARATOR = 0x11;
    const oldBuffer = Buffer.from(buffer); // Copia defensiva

    const startOffset = oldBuffer.indexOf(BYTE_SEPARATOR) + 1;
    const endOffset = oldBuffer.indexOf(0x00, startOffset);

    if (startOffset === 0 || endOffset === -1) {
      console.warn('⚠️ No se encontró IP ASCII válida en el buffer.');
      return buffer;
    }

    const originalIp = oldBuffer.slice(startOffset, endOffset);
    const ipLength = originalIp.length;

    let paddedIp = newIpStr;
    if (newIpStr.length < ipLength) {
      paddedIp = newIpStr.padEnd(ipLength, '\x00');
    }

    const ipBytes = Buffer.from(paddedIp, 'ascii');
    const beforeIp = oldBuffer.slice(0, startOffset);
    const afterIp = oldBuffer.slice(endOffset);

    afterIp.writeUInt8(0x00, 0); // Asegura el terminador
    const updatedBuffer = Buffer.concat([beforeIp, ipBytes, afterIp]);

    console.log(`Reemplazada IP "${originalIp}" -> "${newIpStr}" en offset ${startOffset} hasta ${endOffset}`);

    if (newPort) {
      const signature = Buffer.from([0xB8, 0x22]);
      const portOffset = updatedBuffer.indexOf(signature);
      if (portOffset === -1) {
        throw new Error('❌ No se encontró la secuencia B8 22 para puerto');
      }

      updatedBuffer.writeUInt16LE(parseInt(newPort), portOffset);
      console.log(`Puerto ${newPort} escrito en offset ${portOffset}`);
    }

    console.log(`remplaza ip. Buffer nuevo: ${updatedBuffer.toString('hex')}`);
    return updatedBuffer;
  }


  function extractIpAndPort(buffer) {
    const ascii = buffer.toString('ascii');

    // Buscar la primera IP en el buffer
    const ipMatch = ascii.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    if (!ipMatch) return null;

    const ip = ipMatch[1];
    const ipOffset = ascii.indexOf(ip);

    // Buscar el valor del puerto 8888 en formato Little Endian (0x22B8 -> B8 22)
    const portLE = Buffer.alloc(2);
    portLE.writeUInt16LE(8888, 0);

    const portOffset = buffer.indexOf(portLE, ipOffset);
    const port = portOffset !== -1 ? buffer.readUInt16LE(portOffset) : null;

    return {
      ip,
      port,
      ipOffset,
      portOffset: port !== null ? portOffset : null,
    };
  }

  function get_port(buffer) {
    const portOffsetStart = 72;
    const maxScanLength = 3;

    // Buscar el final del puerto (hasta que se encuentre un 0x00 o se agote el límite)
    let portOffsetEnd = buffer.indexOf(0x00, portOffsetStart);
    if (portOffsetEnd === -1 || portOffsetEnd > portOffsetStart + maxScanLength) {
      console.error('❌ Puerto no encontrado o fuera de rango');
      return null;
    }

    try {
      return buffer.readUInt16LE(portOffsetStart);
    } catch (err) {
      console.error('❌ Error al leer puerto:', err.message);
      return null;
    }
  }

  let aux = []//[replaceBinaryIp(Buffer.from(aux_hex, 'hex'), "1.1.1.1")]

  function process_date(date_start, date_hex) {
    const processingTime = Date.now() - date_start;
    const adjustedTimestamp = date_hex + processingTime;

    const hexStr = adjustedTimestamp.toString(16).padStart(8, '0');
    const result = Buffer.alloc(4);
    result.write(hexStr, 'hex');

    return result;
  }

  function processCFRAME(message, rcon) {
    const bCommand = message.readUInt8(0);
    const bExtOpcode = message.readUInt8(1);
    let response = null
    let idSession = message.slice(8, 12)
    switch (bCommand) {
      case 0x7f:
        token = message
        //console.log('Mensaje_type_4: 0x7f ', message.toString('hex'))
        //console.log('Mensajes type 4 recibidos: ')
        const bSeq = message.readUInt8(2); // Secuencia del DFRAME
        const bNRcv = message.readUInt8(3); // Próximo esperado
        if(message.readUInt8(2) == 0x01){
          response = Buffer.from('7f000102c2000000000000000000000050000000010000000000000002000000e00000001400000000000000000000000000000000000000000000000000000093715e51dee002479ae27c0866e7511a3e49e9edc86a154f8d018b163200b9669071ce510900000000000000020000000000000091717e5100000000020400000200000000000000070000000000000000000000000000000000000000000000000000009071ce510000000000020000090000000000000007000000cc0000001400000000000000000000000000000000000000430068006100760061006c006f00740065000000430068006100760061006c006f00740065000000', 'hex')
        }else if(message.readUInt8(2) == 0x02){
          response = Buffer.from('3700020302000000af3f81c643686176616c6f746500e2060d00', 'hex')
        }
        break;
      case 0x3f:
        idSession = message.slice(4, 8)
        //console.log('Mensaje_type_3: 0x3f ', message.toString('hex'))
        //console.log('Mensajes type 3 recibidos: ')
        if(message.readUInt8(1) === 0x02){
          response = Buffer.alloc(8);
          response = Buffer.from('8006010004040000025a7318', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          response.writeUInt8(message.readUInt8(2), 5); // bExtOpcode (SACK)
          response.set(idSession, response.length - 4);

        }else if(message.readUInt8(1) === 0x08){
          response = Buffer.alloc(8);
          response = Buffer.from('8006010004040000025a7318', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          response.writeUInt8(message.readUInt8(2), 5); // bExtOpcode (SACK)
          response.set(idSession, response.length - 4);
        }else if(message.readUInt8(1) === 0x07){
          response = Buffer.alloc(8);
          response = Buffer.from('8006010004040000025a7318', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          response.writeUInt8(message.readUInt8(2), 5); // bExtOpcode (SACK)
          response.set(idSession, response.length - 4);
        }else if(message.length >= 30 && message.length < 50){
          //console.log('\n\ndataFilter!!! recive!!!\n\n')
          /**/
          /*server.send(response, rcon.port, rcon.addres, (err)=>{
            console.error(err)
          })*/
          let last_idx = message.readUInt8(2) 
          const arr_payloads = manager_party.get_arr_payload( message.readUInt8(1), message.readUInt8(2), message.readUInt8(3))

          const arr_parties = manager_party.get_arr_parties();

          console.log(`🔫 [\x1b[33mMATCHMAKER\x1b[0m] Numero de partidas a enviar: ${arr_payloads.length}`);

          for (let i = 0; i < arr_payloads.length; i++) {
            const payload = arr_payloads[i];
            const party = arr_parties[i];

            if (party && party.detail) {
              const actualizado = party.set_detail_data(Buffer.from(party.payload), party.detail.currentPlayers, party.detail.maxPlayers);
              if (actualizado) {
                arr_payloads[i] = actualizado;
              }
            }    

            server.send(arr_payloads[i], rcon.port, rcon.address, (err) => {
              if (err) {
                console.error('❌ [\x1b[33mMATCHMAKER\x1b[0m] no se ha podido mandar partida');
              } else {
                console.log('⚔️ [\x1b[33mMATCHMAKER\x1b[0m] partida enviada');
              }
            });
          }
          let end_idx = 0x02 + arr_payloads.length
          response = Buffer.from('3f0803046b66c362', 'hex')
          response[3] = end_idx + 1
          response.writeUInt8(0x3f, 0); // bCommand
          response.writeUInt8(0x09, 1); // bExtOpcode (SACK)

          response.set(idSession, response.length - 4);

        }else if (message.length >= 50){
          
          const port = get_port(message)
          //console.log('\n\ndatapart!!!\n\n', port)
          manager_party.add_member(rcon.address, `${port}`, replaceBinaryIp(message, rcon.address, false))
          response = Buffer.from('8006010004040000025a7318', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          response.writeUInt8(message.readUInt8(2) + 1, 5); // bExtOpcode (SACK)
          response.set(idSession, response.length - 4);
  
        }else if(message.readUInt8(1)=== 0x00){
          response = Buffer.from('8006010004040000025a7318', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          response.writeUInt8(message.readUInt8(2) + 1, 5); // bExtOpcode (SACK)
          response.set(idSession, response.length - 4);
        }else if(message.readUInt8(1) === 0x09){
          response = Buffer.from('80060100040400008f82d82d2', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          response.writeUInt8(message.readUInt8(2) + 1, 5); // bExtOpcode (SACK)
          
        }else if(message.readUInt8(1) === 0x03){
          response = Buffer.alloc(8);
          response = Buffer.from('8006010004040000025a7318', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          if(message.readUInt8(2) >= 255){
            message.writeUInt8(0, 2)
          }else{
            response.writeUInt8(message.readUInt8(2)+1, 5);
          }
          // bExtOpcode (SACK)

          response.set(idSession, response.length - 4);
        }else if(message.readUInt8(1) === 0x01){
          response = Buffer.from('8006010004040000025a7318', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          response.writeUInt8(message.readUInt8(2)+1, 5); // bExtOpcode (SACK)
          response.set(idSession, response.length - 4);
        }else if(message.readUInt8(2) === 0x03){
                  response = Buffer.alloc(8);
          response = Buffer.from('8006010004040000025a7318', 'hex')
          response.writeUInt8(message.readUInt8(3), 4); // bExtOpcode (SACK)
          response.writeUInt8(message.readUInt8(2)+1, 5); // bExtOpcode (SACK)
        }
        
        break;
      case 0x80: // FRAME_EXOPCODE_SACK
        //console.log('Mensaje_type_2: 0x80')
        //console.log('Mensajes type 2 recibidos: ')
        if(message.readUInt8(1) === 0x06){
          if(message.readUint8(4) === 0x08 && message.readUInt8(5)===0x05){
            response = Buffer.from("3f080511",'hex')
          }else{
            response = Buffer.from("3f020000d2ed430c","hex")
          }
          /*response.set(process_date(Date.now(), parseInt(message.readUInt32LE(8), 16)), 8);*/
        }else if(message.readUInt8(1) === 0x02){
          response = Buffer.alloc(8);
          response.writeUInt8(0x3f, 0); // bCommand
          response.writeUInt8(0x02, 1); // bExtOpcode (SACK)
          response.writeUInt8(0x00 , 2); // bExtOpcode (SACK)
          response.writeUInt8(0x00, 3); // bExtOpcode (SACK)
          response.set(idSession, response.length - 4);
          
        }
  
        break;
      case 0x88:
        const startTime = Date.now(); // Tiempo de inicio (en milisegundos)
        last_start = startTime
        //console.log('Mensaje_type_1: 0x88')
        //console.log('Mensajes type 1 recibidos: ')
        response = Buffer.alloc(16);
        response.writeUInt8(0x88, 0);
        response.writeUInt8(0x02, 1);
        response.writeUInt8(message.readUInt8(3), 2);
        response.writeUInt8(message.readUInt8(3)+1, 2);
        response.writeUInt8(0x06, 4);
        response.writeUInt8(0x01, 6);
        response.set(idSession, response.length - 8);
        const timestampHex = message.readUInt32LE(12) // Extracto del Timestamp (en hexadecimal)
        const timestamp_calc = process_date(startTime, timestampHex)
        last_date = timestamp_calc
        response.set(timestamp_calc, 12);
        //console.log('response2 buffer: ', response)
        break;
      default:
        console.error('CFRAME no soportado: bExtOpcode desconocido');
        //throw new Error()
        response = null;
    }
    //console.log('message buffer: ', message.toString('hex'))
    //console.log('response: ', response)
    return response
  }
  
  function processMessage(message,rcon) {
    if (message.length >= 4 && (message.readUInt8(0) == 0x88 || (message.readUInt8(0) == 0x80) || (message.readUInt8(0) == 0x3f) || (message.readUInt8(0) == 0x7f) || (message.readUInt8(0) == 0x77)) ) {
      return processCFRAME(message,rcon);
    } else {
      //console.log('msg:', message.toString('hex'), (message.readUInt8(0) == 0x3f))
      console.error('Mensaje no reconocido o inválido');
      //throw new Error('Mensaje no reconocido o inválido')
      return null;
    }
  }

  server.on('message', (msg, rinfo) => {
    console.log(`📩 Mensaje UDP desde ${rinfo.address}:${rinfo.port}`);

    const response = processMessage(msg, rinfo);

    if (response) {
      server.send(response, rinfo.port, rinfo.address, err => {
        if (err) console.error('❌ Error al responder:', err.message);
      });
    }
  });

  // Eventos de socket
  server.on('listening', () => {
    const a = server.address();
    console.log(`🚀 Servidor UDP escuchando en ${a.address}:${a.port}`);
  });

  server.on('error', err => {
    console.error('❌ Error en el servidor:', err.message);
    server.close();
  });

  // Inicio servidor
  const PORT = 8844;
  const HOST = '0.0.0.0';
  server.bind(PORT, HOST);

  // Guardado de partidas
  setInterval(() => {
    const arr = manager_party.get_arr_parties().map(p => ({
      ip: p.ip,
      port: p.port,
      payload: p.payload,
    }));
    exportarArrayAArchivo(arr);
  }, 1000 * 60 * 5); // Cada 5 minutos

} catch (err) {
  console.error('💥 Error crítico en index.js', err.stack);
}
