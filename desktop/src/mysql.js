// Direct database connections from the Electron side (setup, migrations,
// shutdown). The app itself talks to the database through its own server.
const mysql = require('mysql2/promise');

exports.connect = ({ port, user, password, multipleStatements = false }) =>
  mysql.createConnection({ host: '127.0.0.1', port, user, password, multipleStatements, connectTimeout: 10000 });
