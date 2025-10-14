---
id: get-data-from-cuenti
title: 💻 get-data-from-cuenti (Cloud Function)
sidebar_label: Adaptador Cuenti
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
2.  **Procesamiento:** La función llama al *endpoint* PHP (`https://billy.oblicua.co/cuenti/cuenti.php`) usando las credenciales.
3.  **Transformación:** Mapea el arreglo de facturas de Cuenti al esquema interno de Billy.
4.  **Salida (Output):** Devuelve un arreglo de objetos JSON con el formato estandarizado directamente al Workflow.

## 3. Código Fuente (Node.js)

La lógica clave se encuentra en la transformación de la factura y en la llamada al API intermediario.

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const axios = require('axios');

/**
 * Transforma una factura de formato CUENTI a nuestro formato estándar.
 * @param {object} cuentiInvoice - Una factura individual del API de CUENTI/PHP.
 * @returns {object} La factura en el formato que nuestro sistema entiende.
 */
function transformCuentiInvoice(cuentiInvoice) {
    // Helper para formatear fechas que vienen como timestamp de Unix (en milisegundos).
    const formatDate = (timestamp) => {
        if (!timestamp) return null;
        // new Date() en JavaScript acepta milisegundos directamente.
        return new Date(parseInt(timestamp, 10)).toISOString().split('T')[0];
    };

    // Mapea los campos de CUENTI a los nombres de columna que usamos en el resto del sistema.
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
        // Añade aquí cualquier otro campo que necesites del objeto de CUENTI
    };
}

// --- Función Principal ---

functions.http('getDataFromCuenti', async (req, res) => {
    // El workflow nos pasa la configuración de la tarea y las credenciales
    const { credentials, taskConfig } = req.body;

    if (!credentials || !taskConfig) {
        return res.status(400).send('Faltan parámetros: se requieren credentials y taskConfig.');
    }

    try {
        // 1. Construir la solicitud para el script PHP
        const phpUrl = '[https://billy.oblicua.co/cuenti/cuenti.php](https://billy.oblicua.co/cuenti/cuenti.php)';
        // Se usan las credenciales de Secret Manager (ej: idEmpresa, token)
        // y el taskConfig (ej: isTest)
        const phpPayload = {
            idEmpresa: credentials.idEmpresa,
            token: credentials.token,
            test: taskConfig.isTest
        };

        // 2. Llamar al script PHP
        console.log('Llamando al script PHP de CUENTI...');
        const response = await axios.post(phpUrl, phpPayload);
        const cuentiInvoices = response.data;
        
        if (!Array.isArray(cuentiInvoices)) {
            throw new Error('La respuesta del script de CUENTI no es un arreglo de facturas.');
        }
        console.log(`Se recibieron ${cuentiInvoices.length} facturas de CUENTI.`);

        // 3. Transformar cada factura al formato estándar
        const standardizedInvoices = cuentiInvoices.map(transformCuentiInvoice);

        // 4. Devolver las facturas estandarizadas al workflow
        res.status(200).json(standardizedInvoices);

    } catch (error) {
        console.error('Error al procesar datos de CUENTI:', error.response ? error.response.data : error.message);
        res.status(500).send('Error interno al obtener datos de CUENTI.');
    }
});