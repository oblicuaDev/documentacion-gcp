---
id: save-user-credentials
title: 🔒 save-user-credentials (Cloud Function)
sidebar_label: Guardar Credenciales
---

# Función `save-user-credentials`

Esta función es el **Endpoint de Gestión de Secretos** de Billy GCP. Su única responsabilidad es recibir credenciales de integración (ej. `access_key` de Siigo) enviadas desde la interfaz de usuario de Oblicua y almacenarlas de forma segura en **Google Cloud Secret Manager**.

El diseño utiliza la función `upsertSecret` para garantizar que si el secreto ya existe, simplemente se agrega una nueva versión, manteniendo un historial de credenciales.

## 1. Detalles de Despliegue y Seguridad

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Tipo** | Cloud Run Service (Node.js) | Función HTTP. |
| **Región GCP** | `us-south1` | Desplegada en esta región. |
| **URL de Invocación** | `https://save-user-credentials-985640295677.us-south1.run.app` | **Endpoint Público** (usado por la UI). |
| **Autenticación** | Acceso **No Autenticado** | Permite el acceso desde el *frontend* de Oblicua. |
| **CORS** | Limitado al origen `https://devbilly.oblicua.co` | Restricción de seguridad para peticiones de navegador. |
| **Permiso Crítico** | `Secret Manager Secret Admin` | La Cuenta de Servicio debe tener este rol para **crear** y **añadir versiones** a los secretos. |

## 2. Flujo de Datos y Lógica

### A. Entrada (Payload)

La función espera un `POST` con la identificación del usuario, el servicio de integración y el objeto de credenciales.

```json title="Cuerpo de la Petición POST"
{
  "billy_user": "usuario-ejemplo-123",
  "service": "SIIGO", // o CUENTI, ALLEGRA, etc.
  "credentials": {
    "username": "api_user",
    "access_key": "XXXXX-XXXXX-SECRET-TOKEN",
    "partner_id": "12345"
  }
}
```

### B. Proceso de Almacenamiento
  
  ***Construcción del Nombre del Secreto:** Se genera dinámicamente el nombre del secreto en el formato: `[servicio-minúsculas]-[billy_user]-credentials`.
      * Ejemplo: Si `service="SIIGO"` y `billy_user="prueba"`, el secreto será: `siigo-prueba-credentials`.
  ***`upsertSecret`:** Intenta crear el secreto. Si ya existe (`código 6 = ALREADY_EXISTS`), simplemente agrega una nueva versión con el nuevo *payload* (objeto JSON de credenciales).

### C. Importancia de la Seguridad

Esta función es el punto más sensible. Es crítico que la **validación de acceso (mediante JWT en producción)** esté configurada en el entorno de producción para garantizar que solo usuarios autenticados de Oblicua puedan invocar este *endpoint*.

## 3. Código Fuente (Node.js)

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const secretClient = new SecretManagerServiceClient();
const project = 'billy-473802';
const ALLOWED_ORIGIN = '[https://devbilly.oblicua.co](https://devbilly.oblicua.co)';

async function upsertSecret(secretName, payload) {
    try {
        await secretClient.createSecret({
            parent: `projects/${project}`,
            secretId: secretName,
            secret: {
                replication: {
                    automatic: {},
                },
            },
        });
        console.log(`Secreto ${secretName} creado.`);
    } catch (error) {
        if (error.code !== 6) throw error; // 6 = ALREADY_EXISTS
        console.log(`El secreto ${secretName} ya existe. Se añadirá una nueva versión.`);
    }
    const [version] = await secretClient.addSecretVersion({
        parent: `projects/${project}/secrets/${secretName}`,
        payload: {
            data: Buffer.from(JSON.stringify(payload), 'utf8'),
        },
    });
    console.log(`Se añadió la versión ${version.name} al secreto ${secretName}.`);
    return version;
}

functions.http('saveUserCredentials', async (req, res) => {
    // --- Lógica de CORS ---
    res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.set('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const { billy_user, service, credentials } = req.body;

    if (!billy_user || !service || !credentials) {
        return res.status(400).send('Faltan parámetros: se requiere billy_user, service, y credentials.');
    }

    const secretName = `${service.toLowerCase()}-${billy_user}-credentials`;

    try {
        await upsertSecret(secretName, credentials);
        res.status(200).send({ message: `Credenciales para ${service} del usuario ${billy_user} guardadas correctamente.` });
    } catch (error) {
        console.error('Error al guardar el secreto:', error);
        res.status(500).send('Error interno al guardar las credenciales.');
    }
});
