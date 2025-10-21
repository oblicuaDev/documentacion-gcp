---
id: get-data-from-siigo
title: 🔗 get-data-from-siigo (Cloud Function)
sidebar_label: Procesador Siigo
---

# Función `get-data-from-siigo`

Esta función actúa como el **Adaptador de Siigo** dentro del proceso de ingesta. Su principal tarea es realizar la consulta de facturas pendientes a través de un *script* PHP intermediario, navegar la estructura anidada de la respuesta de Siigo y transformar los datos al esquema de mensaje estándar de Billy GCP.

## 1. Detalles de Despliegue

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Tipo** | Cloud Run Service (Node.js) | Función HTTP invocada por Workflows. |
| **Región GCP** | `europe-west1` | Desplegada en esta región (mencionado en el Workflow). |
| **URL de Invocación** | `https://get-data-from-siigo-985640295677.europe-west1.run.app` | **Endpoint privado**. |
| **Autenticación** | Requiere **IAM** | Solo invocable por la Cuenta de Servicio del `Billy-workflow`. |
| **Dependencia Clave** | `axios` | Usada para realizar la petición POST al *script* intermediario. |

## 2. Flujo de Datos y Lógica

### A. Entrada (Payload)

Recibe la configuración de la tarea (`taskConfig`) y las credenciales de Secret Manager, tal como lo hace la función de Cuenti.

### B. Mapeo de Campos Críticos

La función `transformSiigoInvoice` es responsable de la lógica de mapeo, utilizando *optional chaining* para navegar las estructuras anidadas y obtener campos como teléfono y email del contacto principal del cliente. El mapeo se realiza de forma robusta para manejar estructuras de respuesta variables de Siigo.

### C. Procesamiento de Respuesta

La respuesta del *script* intermediario de Siigo se espera en un formato muy específico y anidado: `response.data[0].data.results`. Si la respuesta no es un arreglo válido en esa ruta, el proceso genera un error.

## 3. Código Fuente (Node.js)

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const axios = require('axios');

/**
 * Transforma una factura de formato SIIGO a nuestro formato estándar.
 * @param {object} siigoInvoice - Una factura individual del API de SIIGO/PHP.
 * @returns {object} La factura en el formato que nuestro sistema entiende.
 */
function transformSiigoInvoice(siigoInvoice) {
    // Helpers para obtener datos de forma segura de objetos anidados
    const getContact = (invoice) => invoice.customer?.details?.contacts?.[0] || {};
    const getContactPhone = (invoice) => getContact(invoice).phone || {};

    return {
        'No._Factura': siigoInvoice.name, // ej: "FV-3-60"
        'Fecha_de_vencimiento': siigoInvoice.payments?.[0]?.due_date || null,
        'Días_en_Mora': siigoInvoice.dias_en_mora || 0,
        'Monto': siigoInvoice.balance,
        'Fecha_creación': siigoInvoice.date,
        'Razón_social_cliente': siigoInvoice.customer?.details?.name?.[0] || null,
        'Cel_Cliente': getContactPhone(siigoInvoice).number,
        'email_Cliente': getContact(siigoInvoice).email,
        'Indicativo_Cel_Cliente': getContactPhone(siigoInvoice).indicative,
        'Nit_Cliente': siigoInvoice.customer?.details?.identification,
    };
}

// --- Función Principal ---

functions.http('getDataFromSiigo', async (req, res) => {
    const { credentials, taskConfig } = req.body;

    if (!credentials || !taskConfig) {
        return res.status(400).send('Faltan parámetros: se requieren credentials y taskConfig.');
    }

    try {
        // 1. Construir la solicitud para el script PHP de SIIGO
        const phpUrl = '[https://billy.oblicua.co/cuenti/siigo.php](https://billy.oblicua.co/cuenti/siigo.php)';
        const phpPayload = {
            username: credentials.username,
            access_key: credentials.access_key,
            partner_id: credentials.partner_id,
            test: taskConfig.isTest
        };

        // 2. Llamar al script PHP
        console.log('Llamando al script PHP de SIIGO...');
        const response = await axios.post(phpUrl, phpPayload);
        
        // 3. Navegar la respuesta anidada
        const siigoInvoices = response.data?.[0]?.data?.results;

        if (!Array.isArray(siigoInvoices)) {
            throw new Error('La respuesta del script de SIIGO no contiene un arreglo de facturas en la ruta esperada.');
        }
        console.log(`Se recibieron ${siigoInvoices.length} facturas de SIIGO.`);

        // 4. Transformar cada factura al formato estándar
        const standardizedInvoices = siigoInvoices.map(transformSiigoInvoice);

        // 5. Devolver las facturas estandarizadas al workflow
        res.status(200).json(standardizedInvoices);

    } catch (error) {
        console.error('Error al procesar datos de SIIGO:', error.response ? error.response.data : error.message);
        res.status(500).send('Error interno al obtener datos de SIIGO.');
    }
});
