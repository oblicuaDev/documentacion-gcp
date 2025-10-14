---
id: ingest-task-from-billy
title: 🔗 ingest-task-from-billy (Cloud Function)
sidebar_label: Punto de Ingesta
---

# Función `ingest-task-from-billy`

Esta función es el **Endpoint de Ingesta de Tareas**. Es el único servicio que está configurado con acceso público (respetando las reglas CORS) y su única misión es recibir la configuración de una tarea de cobro (ej. "enviar facturas de Siigo al usuario X") e iniciar la ejecución del `Billy-workflow`.

## 1. Detalles de Despliegue

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Tipo** | Cloud Run Service (Node.js) | Función HTTP. |
| **Región GCP** | `northamerica-south1` | Desplegada en esta región. |
| **URL de Invocación** | `https://ingest-task-from-billy-985640295677.northamerica-south1.run.app` | **Endpoint Público** (usado por la UI). |
| **Autenticación** | Acceso **No Autenticado** | Permite el acceso desde el frontend (UI de Oblicua). |
| **CORS** | Limitado al origen `https://devbilly.oblicua.co` | Restricción de seguridad para peticiones de navegador. |
| **Librería Clave** | `@google-cloud/workflows` | Utilizada para iniciar el Workflow. |

## 2. Flujo de Control

### A. Entrada (Payload)

El cuerpo de la petición **`POST`** contiene la configuración de la tarea seleccionada por el usuario, que se pasará como argumento al Workflow.

```json title="taskData (JSON de Entrada)"
{
  "data": {
    "billy_user": "ID_DEL_USUARIO",
    "integration": {
      "platform": "GoogleSheets", // o SIIGO, CUENTI, etc.
      "link_drive": "URL_DE_LA_MATRIZ"
    },
    "isTest": false
    // Otros filtros de canal y tono
  }
}

```
### B. Proceso de Orquestación

1.  **Validación:** Se verifica que el método sea `POST` y que el payload contenga el objeto `data`.
2.  **Manejo de CORS:** Responde a peticiones `OPTIONS` y establece los encabezados de `Access-Control` para permitir que el *frontend* de Oblicua interactúe con la función.
3.  **Inicio del Workflow:** Utiliza el cliente `ExecutionsClient` para iniciar el `Billy-workflow` con el objeto `taskData` como argumento (`argument: JSON.stringify(taskData)`).

### C. Éxito y Errores

* **Respuesta 202 (Accepted):** Devuelve inmediatamente una respuesta 202 con el ID de la ejecución del Workflow, sin esperar a que el proceso de cobro termine.
* **Permisos:** La Cuenta de Servicio de esta función debe tener el rol **`Workflows Invoker`** para poder iniciar la ejecución del `Billy-workflow`.

## 3. Código Fuente (Node.js)

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const { ExecutionsClient } = require('@google-cloud/workflows').v1;

// --- Configuración ---
const client = new ExecutionsClient();
const project = 'billy-473802';
const location = 'northamerica-south1';
const workflow = 'Billy-workflow';
const ALLOWED_ORIGIN = '[https://devbilly.oblicua.co](https://devbilly.oblicua.co)';
// --- Fin de la Configuración ---

functions.http('ingestTask', async (req, res) => {
    // --- Lógica para manejar CORS ---
    res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.set('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }
    // --- Fin de la Lógica para manejar CORS ---

    if (req.method !== 'POST' || !req.body) {
        return res.status(400).send('Bad Request: Se requiere un cuerpo JSON en una solicitud POST.');
    }

    // Se lee directamente de req.body.data
    const taskData = req.body.data;
    if (!taskData) {
        return res.status(400).send('Bad Request: El formato del JSON es incorrecto. No se encontró el objeto "data".');
    }
    
    console.log(`Tarea recibida para el usuario de Billy: ${taskData.billy_user}`);
    console.log(`Link de Drive: ${taskData.link_drive}`);
    console.log(`Es una prueba (isTest): ${taskData.isTest}`);

    try {
        const [execution] = await client.createExecution({
            parent: client.workflowPath(project, location, workflow),
            execution: {
                argument: JSON.stringify(taskData),
            },
        });
        console.log(`Workflow iniciado con éxito. ID de ejecución: ${execution.name}`);
        res.status(202).send({ message: 'Task accepted', executionId: execution.name });
    } catch (error) {
        console.error('Error al iniciar el workflow:', error);
        res.status(500).send('Error Interno del Servidor al iniciar el workflow.');
    }
});