---
id: process-and-send-message
title: 🤖 process-and-send-message (Lógica Central de Envío)
sidebar_label: Procesar y Enviar
---

# Función `process-and-send-message`

Esta función Cloud Run es el **Handler Final** del `Billy-workflow`. Su responsabilidad principal es determinar el contenido del mensaje (usando OpenAI), seleccionar el canal de envío adecuado (Email, SMS o WhatsApp) según la configuración del cliente, y registrar la acción en la API de *analytics* de Billy.

## 1. Detalles de Despliegue

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Tipo** | Cloud Run Service (Node.js) | Función HTTP invocada por el loop del Workflow. |
| **Región GCP** | `northamerica-south1` | Mismo *datacenter* que el Workflow. |
| **URL de Invocación** | `https://process-and-send-message-985640295677.northamerica-south1.run.app` | **Endpoint privado**. |
| **Autenticación** | Requiere **IAM** | Solo invocable por la Cuenta de Servicio del `Billy-workflow`. |
| **Dependencias Externas** | OpenAI, Campaign Monitor, sms.to, API de Registro de Billy. | Requiere acceso a múltiples APIs de terceros. |

## 2. Flujo de Procesamiento y Lógica de Negocio

El flujo de procesamiento sigue estos pasos críticos:

1.  **Obtención de Claves:** Se obtienen todas las API Keys necesarias de **Secret Manager** (`openai-api-key`, `campaign-monitor-api-key`, etc.).
2.  **Filtro Inicial:** Se omite el procesamiento si la factura no tiene **Días en Mora (> 0)** o **Monto** definido.
3.  **Generación de Mensaje (OpenAI):**
    * Se construye un *prompt* detallado con la información de la factura y la configuración del cliente (incluyendo la lógica de tono en `taskConfig.tonos`).
    * Se llama al **Asistente de OpenAI** (`asst_56YtrqC8wtBXx7lZMl6aMyK2`) para determinar el **`type`** de canal (`EMAIL`, `SMS`, `WHATSAPP`) y generar el contenido (`msg`, `subject`).
4.  **Selección y Ejecución de Canal (`switch`):**

| Canal Determinado | Acción de Envío | Lógica Adicional |
| :--- | :--- | :--- |
| **EMAIL / TEMPLATE** | Usa **Campaign Monitor** para enviar el correo dinámico. | El tipo `TEMPLATE` utiliza el HTML predefinido en `taskConfig.tonos.con_plantilla.html_content`. |
| **SMS** | Llama a la función **`shortenForSms`** (que usa GPT-3.5-turbo) para reducir el mensaje a < 160 caracteres y luego lo envía a través del API de **sms.to**. | Usa `invoiceData.Indicativo_Cel_Cliente` para el código de país. |
| **WHATSAPP** | (Lógica de envío al servicio de WhatsApp pendiente) | Se salta el envío si no hay número de celular. |

5.  **Registro (`postToBilly`):** Si la ejecución **NO** está en modo `isTest`, se envía el registro de la acción a la API de *analytics* de Billy para su seguimiento.

## 3. Código Fuente (Node.js)

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const OpenAI = require('openai');
const axios = require('axios');

const secretClient = new SecretManagerServiceClient();
let openai;

// --- Funciones Helper ---

async function getApiKeys() {
    const [openaiKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/openai-api-key/versions/latest' });
    const [campaignKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/campaign-monitor-api-key/versions/latest' });
    const [smsKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/smsto-api-key/versions/latest' });
    const [billyToken] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/billy-api-token/versions/latest' });
    openai = new OpenAI({ apiKey: openaiKey.payload.data.toString('utf8') });
    return {
        campaignKey: campaignKey.payload.data.toString('utf8'),
        smsKey: smsKey.payload.data.toString('utf8'),
        billyToken: billyToken.payload.data.toString('utf8')
    };
}

function buildPrompt(invoice, config) {
    const getVal = (value, fallback) => value || fallback;
    return `Crea un mensaje de cobranza para esta factura:
- Empresa que cobra: ${getVal(invoice.Cobrador_si_empresa_no_es_el_cobrador_final, config.razon_social)}
- Link de pago: ${getVal(config.link_pago, "No hay Link de pago")}
- Cliente deudor: ${getVal(invoice.Razón_social_cliente, '')}
- ¿El cliente deudor es empresa?: ${config.client_type}
- Numero de la factura: ${getVal(invoice['No._Factura'], "No tener en cuenta número de factura en el mensaje")}
- Fecha en que venció la factura: ${getVal(invoice.Fecha_de_vencimiento, "No tener en cuenta fecha de vencimiento de factura en el mensaje")}
- Días en mora de la factura: ${getVal(invoice.Días_en_Mora, "No tener en cuenta días en mora de factura en el mensaje")}
- Monto de la factura: ${getVal(invoice.Monto, "No tener en cuenta monto de la factura en el mensaje")}
- Objeto JSON para definir el tono y el canal del mensaje: ${JSON.stringify(config.tonos)}
- La fecha actual es: ${new Date().toISOString()}
- Esta factura ya está vencida. `;
}

async function callAssistant(prompt, assistantId) {
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, { role: "user", content: prompt });
    const run = await openai.beta.threads.runs.create(thread.id, { assistant_id: assistantId });
    let currentRun;
    do {
        await new Promise(resolve => setTimeout(resolve, 1500));
        currentRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    } while (currentRun.status === 'in_progress' || currentRun.status === 'queued');
    if (currentRun.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(thread.id);
        const assistantResponse = messages.data[0].content[0].text.value;
        return JSON.parse(assistantResponse);
    } else {
        throw new Error(`El Run del asistente falló con el estado: ${currentRun.status}`);
    }
}

async function sendCampaignMonitorEmail(apiKey, clientId, fromName, fromEmail, recipientEmail, subject, htmlContent) {
    const url = `https://api.createsend.com/api/v3.3/transactional/classicemail/send?clientID=${clientId}`;
    const payload = {
        From: `"${fromName}" <${fromEmail}>`,
        To: [recipientEmail],
        Subject: subject,
        Html: htmlContent,
        ConsentToTrack: "Unchanged"
    };
    const credentials = Buffer.from(`${apiKey}:x`).toString('base64');
    const headers = { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' };
    await axios.post(url, payload, { headers });
    console.log(`Correo dinámico enviado a ${recipientEmail} exitosamente.`);
}

async function shortenForSms(message) {
    const prompt = `Acorta el siguiente mensaje a menos de 160 caracteres para un SMS. Sé conciso y mantén el link de pago si existe. Mensaje original: "${message}"`;
    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0].message.content;
}

async function postToBilly(billyToken, payload) {
    const url = '[https://damp-dawn-69908-08d523d79e5b.herokuapp.com/api/create-bulk-entries](https://damp-dawn-69908-08d523d79e5b.herokuapp.com/api/create-bulk-entries)';
    await axios.post(url, payload, {
        headers: { 'token': billyToken, 'Content-Type': 'application/json' }
    });
    console.log('Información enviada a Billy exitosamente.');
}

// --- Función Principal ---

functions.http('processAndSendMessage', async (req, res) => {
    const { invoiceData, taskConfig } = req.body;
    const ASSISTANT_ID = 'asst_56YtrqC8wtBXx7lZMl6aMyK2';
    const SENDER_EMAIL = 'no-reply@cobrosautomaticos.com';
    const CAMPAIGN_MONITOR_CLIENT_ID = '254000907423a7e16351ee3ac9d373ef';

    // Filtro inicial de procesamiento
    if (!(parseInt(invoiceData.Días_en_Mora, 10) > 0 || invoiceData.Monto)) {
        console.log(`Factura ${invoiceData['No._Factura']} omitida por filtro.`);
        return res.status(200).send({ status: 'skipped', reason: 'Filter not met' });
    }

    try {
        const apiKeys = await getApiKeys();
        const prompt = buildPrompt(invoiceData, taskConfig);
        const gptResponse = await callAssistant(prompt, ASSISTANT_ID);
        const { type, subject, msg, amount } = gptResponse;
        
        let billyPayload = {};
        let channelId = 0;

        switch (type.toUpperCase()) {
            case 'EMAIL':
            case 'TEMPLATE':
                console.log(`Procesando envío para tipo: ${type}`);
                const senderName = taskConfig.razon_social || "Tu Empresa";
                let htmlToSend;

                if (type.toUpperCase() === 'EMAIL') {
                    htmlToSend = msg;
                } else { // TEMPLATE
                    htmlToSend = taskConfig.tonos.con_plantilla.html_content; 
                    if (!htmlToSend) {
                        throw new Error("No se encontró el contenido HTML de la plantilla en taskConfig para el tipo 'TEMPLATE'.");
                    }
                }
                
                // Se decide a quién enviar el correo basado en el flag isTest.
                const recipientEmail = taskConfig.isTest ? taskConfig.test_email : invoiceData.email_Cliente;
                
                await sendCampaignMonitorEmail(apiKeys.campaignKey, CAMPAIGN_MONITOR_CLIENT_ID, senderName, SENDER_EMAIL, recipientEmail, subject, htmlToSend);
                
                channelId = 2; // ID de canal para correo
                billyPayload = {
                    clients: [{ name: invoiceData.Razón_social_cliente, email: invoiceData.email_Cliente, billy_user: taskConfig.billy_user }],
                    invoices: [{ number: invoiceData['No._Factura'] || invoiceData.__ROW_NUMBER__, amount: amount }],
                    records: [{ billy_user: taskConfig.billy_user, channel: channelId, date: new Date().toISOString().split('T')[0] }]
                };
                break;

            case 'SMS':
                console.log('Enviando por SMS...');
                const shortMessage = await shortenForSms(msg);
                const countryCode = invoiceData.Indicativo_Cel_Cliente || '57'; 
                const phone = taskConfig.isTest ? taskConfig.test_phone : invoiceData.Cel_Cliente;
                const smsUrl = `https://api.sms.to/sms/send?api_key=${apiKeys.smsKey}&to=+${countryCode}${phone}&message=${encodeURIComponent(shortMessage)}&sender_id=oblicua`;
                await axios.post(smsUrl);

                channelId = 3; // ID de canal para SMS
                billyPayload = {
                    clients: [{ name: invoiceData.Razón_social_cliente, email: invoiceData.email_Cliente, billy_user: taskConfig.billy_user }],
                    invoices: [{ number: invoiceData['No._Factura'] || invoiceData.__ROW_NUMBER__, amount: amount, message: shortMessage }],
                    records: [{ billy_user: taskConfig.billy_user, channel: channelId, date: new Date().toISOString().split('T')[0] }]
                };
                break;

            case 'WHATSAPP':
                if (!invoiceData.Cel_Cliente) {
                    return res.status(200).send({ status: 'skipped', reason: 'No WhatsApp number' });
                }
                console.log('Enviando por WhatsApp...');
                
                channelId = 3; // Usa el mismo ID que SMS si el servicio es similar
                billyPayload = {
                    clients: [{ name: invoiceData.Razón_social_cliente, email: invoiceData.email_Cliente, billy_user: taskConfig.billy_user }],
                    invoices: [{ number: invoiceData['No._Factura'] || invoiceData.__ROW_NUMBER__, amount: amount, message: "Mensaje de WhatsApp enviado" }],
                    records: [{ billy_user: taskConfig.billy_user, channel: channelId, date: new Date().toISOString().split('T')[0] }]
                };
                break;

            default:
                console.log(`Tipo de mensaje desconocido: ${type}`);
                return res.status(200).send({ status: 'skipped', reason: 'Unknown message type' });
        }

        // Registro de la acción (solo si no es modo Test)
        if (!taskConfig.isTest && Object.keys(billyPayload).length > 0) {
            await postToBilly(apiKeys.billyToken, billyPayload);
        }

        res.status(200).send({ status: 'success', channel: type });
    } catch (error) {
        console.error('Error en processAndSendMessage:', error.response ? error.response.data : error.message);
        res.status(500).send('Error interno al procesar la factura.');
    }
});

```
## 4. Esquema de Salida de OpenAI (Referencia)

Para que la lógica de envío pueda determinar el canal y el contenido, la respuesta del Asistente de OpenAI debe seguir un esquema JSON estricto.

```json title="Output del Asistente de OpenAI"
{
    "type": "EMAIL" | "SMS" | "WHATSAPP" | "TEMPLATE",
    "subject": "Asunto del correo",
    "msg": "El mensaje de cobranza generado por la IA",
    "amount": 125000.50 
}