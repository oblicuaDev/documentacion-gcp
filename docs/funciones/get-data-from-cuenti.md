---
id: get-data-from-cuenti
title: 💻 get-data-from-cuenti (Cloud Function)
sidebar_label: Procesador Cuenti
---

# Función `get-data-from-cuenti`

Esta función Cloud Run actúa como el **adaptador de datos** para el sistema de facturación Cuenti. Su principal responsabilidad es consultar las facturas pendientes a través de un *script* PHP intermediario y transformar el formato nativo de Cuenti al esquema de mensaje estándar de Billy GCP.

## 1. Detalles de Despliegue

Esta función se despliega como un servicio **Cloud Run** (aunque usa el *framework* de funciones, se ejecuta como un servicio HTTP escalable).

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Tipo** | Cloud Run Service (Node.js) | Función HTTP disparada por Workflows. |
| **Región GCP** | `us-central1` | Para baja latencia con otros servicios de Norteamérica. |
| **URL de Invocación** | `https://get-data-from-cuenti-985640295677.us-central1.run.app` | **Endpoint privado**. |
| **Autenticación** | Requiere **IAM** (Solo la cuenta de servicio del Workflow puede invocarla). | Seguridad estricta entre servicios internos. |
| **Tiempo de Espera** | 300 segundos (5 minutos) | Configuración para ingesta de grandes lotes de facturas. |

## 2. Flujo de Datos

1.  **Entrada (Input):** Recibe un **`POST`** del Workflow con la configuración de la tarea (`taskConfig`) y credenciales sensibles (`credentials`) obtenidas de Secret Manager.
2.  **Procesamiento:** La función llama al *endpoint* PHP (`https://billy.oblicua.co/cuenti/cuenti.php`).
3.  **Transformación Crítica:** La respuesta del script PHP es un **string JSON anidado** que debe ser decodificado (`JSON.parse`) antes del mapeo de campos.
4.  **Salida (Output):** Devuelve un arreglo de objetos JSON con el formato estandarizado, incluyendo la inicialización de los nuevos campos de control (`Etapa_actual`, `Cobrador_...`), directamente al Workflow.

## 3. Código Fuente (Node.js)

La lógica clave se encuentra en la manipulación de la respuesta anidada y la inclusión de los nuevos campos en la transformación.

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const axios = require('axios');

/**
 * Transforma un objeto de factura con el formato de CUENTI al formato estándar del sistema.
 * @param {object} cuentiInvoice - Un objeto de factura individual con la estructura devuelta por el script de CUENTI.
 * @returns {object} Un objeto de factura con la estructura estandarizada que el sistema espera.
 */
function transformCuentiInvoice(cuentiInvoice) {
    /**
     * Convierte un timestamp de Unix (en milisegundos) a una fecha en formato YYYY-MM-DD.
     * @param {number} timestamp - El timestamp a formatear.
     * @returns {string|null} La fecha formateada o null si el timestamp no es válido.
     */
    const formatDate = (timestamp) => {
        if (!timestamp) return null;
        return new Date(parseInt(timestamp, 10)).toISOString().split('T')[0];
    };

    // Mapea los campos de la respuesta de CUENTI a los nombres de clave estándar
    // que la función 'process-and-send-message' espera recibir.
    return {
        'No._Factura': cuentiInvoice.nFactura,
        'Fecha_de_vencimiento': formatDate(cuentiInvoice.fecha_vencimiento),
        'Días_en_Mora': cuentiInvoice.dias_vencimiento ? parseInt(cuentiInvoice.dias_vencimiento, 10) * -1 : 0,
        'Monto': cuentiInvoice.total_pendiente_pago,
        'Fecha_creación': formatDate(cuentiInvoice.fecha_registro),
        'Razón_social_cliente': cuentiInvoice.nombre_cliente,
        'Cel_Cliente': cuentiInvoice.movil,
        'email_Cliente': cuentiInvoice.email,
        'Indicativo_Cel_Cliente': cuentiInvoice.prefijo,
        'Nit_Cliente': cuentiInvoice.identificacion,
        'Etapa_actual': null,
        'Cobrador_si_Grupo_Oblicua_SAS_no_es_el_cobrador_final': null
    };
}

// --- Función Principal ---

/**
 * Cloud Function activada por HTTP para obtener y procesar datos de facturas desde CUENTI.
 */
functions.http('getDataFromCuenti', async (req, res) => {
    // El workflow pasa las credenciales (obtenidas de Secret Manager) y la configuración de la tarea.
    const { credentials, taskConfig } = req.body;

    // Valida que la solicitud contenga los datos necesarios para operar.
    if (!credentials || !taskConfig) {
        return res.status(400).send('Faltan parámetros: se requieren credentials y taskConfig.');
    }

    try {
        // Define la URL del script PHP intermediario y construye el payload con las credenciales.
        const phpUrl = '[https://billy.oblicua.co/cuenti/cuenti.php](https://billy.oblicua.co/cuenti/cuenti.php)';
        const phpPayload = {
            idEmpresa: credentials.idEmpresa,
            token: credentials.token,
            test: taskConfig.isTest
        };

        // Realiza la llamada HTTP POST al script PHP para obtener los datos de las facturas.
        console.log('Llamando al script PHP de CUENTI...');
        const response = await axios.post(phpUrl, phpPayload);
        
        // Extrae el string de datos JSON de la respuesta anidada del script PHP.
        const cuentiInvoicesString = response.data?.[0]?.data;
        if (!cuentiInvoicesString || typeof cuentiInvoicesString !== 'string') {
            throw new Error('La respuesta del script de CUENTI no contiene un string de datos válido.');
        }

        // Convierte el string JSON en un arreglo de objetos de factura utilizable.
        const cuentiInvoices = JSON.parse(cuentiInvoicesString);

        if (!Array.isArray(cuentiInvoices)) {
            throw new Error('Los datos parseados de CUENTI no son un arreglo de facturas.');
        }
        console.log(`Se recibieron ${cuentiInvoices.length} facturas de CUENTI.`);

        // Itera sobre cada factura recibida y la transforma al formato estándar del sistema.
        const standardizedInvoices = cuentiInvoices.map(transformCuentiInvoice);

        // Devuelve la lista de facturas ya estandarizadas al workflow que invocó la función.
        res.status(200).json(standardizedInvoices);

    } catch (error) {
        // Captura y registra cualquier error ocurrido durante el proceso para facilitar la depuración.
        console.error('Error al procesar datos de CUENTI:', error.response ? error.response.data : error.message);
        res.status(500).send('Error interno al obtener datos de CUENTI.');
    }
});