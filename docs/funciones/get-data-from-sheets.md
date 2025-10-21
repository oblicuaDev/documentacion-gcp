---
id: get-data-from-sheets
title: 📄 get-data-from-sheets (Cloud Function)
sidebar_label: Procesador Google Sheets
---

# Función `get-data-from-sheets`

Esta función es el **Adaptador de Google Sheets** dentro del proceso de ingesta de Billy GCP. Su propósito es acceder a una matriz de facturas provista por el cliente, autenticarse usando una Cuenta de Servicio y transformar las filas en objetos JSON estandarizados para su posterior procesamiento.

## 1. Detalles de Despliegue y Autenticación

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Tipo** | Cloud Run Service (Node.js) | Función HTTP invocada por Workflows. |
| **Región GCP** | `northamerica-south1` | Desplegada en esta región. |
| **URL de Invocación** | `https://get-data-from-sheets-985640295677.northamerica-south1.run.app` | **Endpoint privado**. |
| **Autenticación** | Requiere **IAM** | Solo puede ser invocada por la Cuenta de Servicio del `Billy-workflow`. |
| **Credenciales** | Obtenidas de **Secret Manager** | Requiere acceso al secreto `google-sheets-credentials`. |

## 2. Flujo de Datos y Lógica

### A. Entrada (Payload)

La función espera un objeto JSON con el enlace del *spreadsheet* y un *flag* de prueba.

```json title="Cuerpo de la Petición POST"
{
  "link_drive": "URL_COMPLETA_DEL_SPREADSHEET",
  "isTest": false 
}
```

### B. Proceso de Lectura

1. **Autenticación:** Utiliza las credenciales de la Cuenta de Servicio obtenidas de Secret Manager.
2. **Extracción de ID:** El ID del *spreadsheet* se extrae mediante una expresión regular del `link_drive` proporcionado.
3. **Rango de Lectura:** Se lee la hoja **'Facturas por cobrar'** en el rango **`A:M`**.
4. **Mapeo:** La primera fila se usa como cabecera para mapear las filas restantes a objetos clave-valor.

### C. Validación y Filtrado

La función aplica una validación estricta para asegurar la calidad de los datos antes de la ingesta:

* Se filtran las filas donde las columnas de **Monto** o **Email** estén vacías (columnas D y I respectivamente).
* Si `isTest` es `true`, la salida se limita a las **primeras 5 filas** válidas.

## 3. Código Fuente (Node.js)

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const { google } = require('googleapis');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const secretClient = new SecretManagerServiceClient();

// Helper para obtener credenciales de la cuenta de servicio para Google Sheets
async function getSheetCredentials() {
  const [version] = await secretClient.accessSecretVersion({
    name: 'projects/billy-473802/secrets/google-sheets-credentials/versions/latest',
  });
  return JSON.parse(version.payload.data.toString('utf8'));
}

functions.http('getDataFromSheets', async (req, res) => {
  const { link_drive, isTest } = req.body;

  if (!link_drive) {
    return res.status(400).send('Falta el parámetro link_drive.');
  }

  try {
    // Autenticación con Google Sheets
    const serviceAccountCreds = await getSheetCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountCreds,
      scopes: ['[https://www.googleapis.com/auth/spreadsheets.readonly](https://www.googleapis.com/auth/spreadsheets.readonly)'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Extraer el ID del spreadsheet desde el link
    const spreadsheetId = link_drive.match(/\/d\/(.+?)\//)[1];
    if (!spreadsheetId) {
      return res.status(400).send('Link de Drive no válido.');
    }

    // Leer los datos de la hoja
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Facturas por cobrar'!A:M", //
    });

    let rows = response.data.values || [];
    const header = rows.shift(); // Quitar la cabecera

    // Aplicar límite si es un test
    if (isTest) {
      rows = rows.slice(0, 5);
    }
    
    // Validar y filtrar filas
    const validRows = rows.filter(row => {
      const amount = row[3];  // Columna D
      const email = row[8];   // Columna I
      return amount && email; // Es obligatorio que tengan datos
    }).map((row, index) => {
      // Convertir el array de la fila a un objeto para fácil acceso
      const rowObject = {};
      header.forEach((key, i) => {
        // Limpiamos los nombres de las columnas para usarlos como claves
        const cleanKey = key.trim().replace(/\s+/g, '_');
        rowObject[cleanKey] = row[i] || null;
      });
      rowObject.__ROW_NUMBER__ = index + 2; // Guardamos el número de fila original
      return rowObject;
    });

    res.status(200).json(validRows);
  } catch (error) {
    console.error('Error al leer Google Sheet:', error);
    res.status(500).send('Error interno al procesar el archivo de Google Sheets.');
  }
});
