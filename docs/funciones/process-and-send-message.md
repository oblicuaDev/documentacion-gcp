---
id: process-and-send-message
title: 🤖 process-and-send-message (Lógica Central de Envío)
sidebar_label: Procesar y Enviar
---

# Función `process-and-send-message`

Esta función Cloud Run es el **Handler Final** del `Billy-workflow` y el componente más complejo de la arquitectura. Su rol es orquestar la **Inteligencia Artificial (OpenAI)** para generar el mensaje, seleccionar el canal de envío **multi-tono** (Email, SMS, WhatsApp) y registrar la acción en el sistema de *analytics* de Billy.

## 1. Detalles de Despliegue

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Tipo** | Cloud Run Service (Node.js) | Función HTTP invocada por el loop del Workflow. |
| **Región GCP** | `northamerica-south1` | Mismo *datacenter* que el Workflow. |
| **URL de Invocación** | `https://process-and-send-message-985640295677.northamerica-south1.run.app` | **Endpoint privado**. |
| **Autenticación** | Requiere **IAM** | Solo invocable por la Cuenta de Servicio del `Billy-workflow`. |
| **Dependencias Externas** | **OpenAI (GPT & Asistente), Meta/WhatsApp API, Campaign Monitor, sms.to.** | Se requiere un amplio acceso a múltiples APIs de terceros. |

## 2. Flujo de Procesamiento y Lógica de Negocio

El flujo central ahora incluye una **lógica de ramificación avanzada** para WhatsApp basada en el tono de cobro:

### A. Lógica de Tono y Canal

1.  **Filtro Inicial:** Se omite si no hay días en mora o monto.
2.  **Generación de Mensaje (OpenAI):** El Asistente de OpenAI determina el **canal (`type`)** y el **tono (`tone`)** de la comunicación. El output incluye un JSON con `type`, `subject`, `msg`, `amount`, y `tone`.
3.  **EMAIL / TEMPLATE:** Usa Campaign Monitor. Permite usar el contenido generado por IA (`EMAIL`) o una plantilla HTML predefinida (`TEMPLATE`).
4.  **SMS:** Usa la función `shortenForSms` (llamada a GPT-3.5-turbo) para garantizar que el mensaje no exceda los 160 caracteres antes de enviarlo por la API de `sms.to`.
5.  **WHATSAPP (NUEVO):**
    * Utiliza el token y las plantillas de la API de Meta, extraídas de Secret Manager.
    * La lógica selecciona la plantilla correcta (`exigente`, `formal`, `amistoso`) basándose en el campo `tone` devuelto por la IA.
    * Incluye una **lógica especial para el usuario 20 (SOS Jurídico)**, utilizando tokens y plantillas específicos para ese flujo legal.

### B. Registro de la Acción

* Se utiliza la función `buildBillyPayload` para estandarizar el registro con los campos **`etapa`**, **`due_date`**, **`days_outstanding`**, y el **`channel`** adecuado (`channelId: 1` para Email, `2` para SMS, `3` para WhatsApp).
* La acción se registra en la API de Billy **solo si no es un modo de prueba (`isTest`)**.

## 3. Código Fuente (Node.js)

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const OpenAI = require('openai');
const axios = require('axios');

const secretClient = new SecretManagerServiceClient();
let openai;

// --- Funciones Auxiliares ---

/**
 * Obtiene todas las claves de API y plantillas de texto necesarias desde Secret Manager.
 * (Actualizada para incluir las 5 claves/plantillas de WhatsApp)
 * @returns {Promise<object>} Un objeto con todas las claves y plantillas.
 */
async function getApiKeys() {
    const [openaiKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/openai-api-key/versions/latest' });
    const [campaignKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/campaign-monitor-api-key/versions/latest' });
    const [smsKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/smsto-api-key/versions/latest' });
    const [billyToken] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/billy-api-token/versions/latest' });
    const [whatsappToken] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-api-token/versions/latest' });
    const [whatsappSosToken] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-billy-sos-api-token/versions/latest' });
    const [whatsappTemplateExigente] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-template-exigente/versions/latest' });
    const [whatsappTemplateFormal] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-template-formal/versions/latest' });
    const [whatsappTemplateAmistoso] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-template-amistoso/versions/latest' });
    const [whatsappTemplateSos] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-template-sos-juridico/versions/latest' });

    openai = new OpenAI({ apiKey: openaiKey.payload.data.toString('utf8') });
    return {
        campaignKey: campaignKey.payload.data.toString('utf8'),
        smsKey: smsKey.payload.data.toString('utf8'),
        billyToken: billyToken.payload.data.toString('utf8'),
        whatsappToken: whatsappToken.payload.data.toString('utf8'),
        whatsappSosToken: whatsappSosToken.payload.data.toString('utf8'),
        whatsappTemplateExigente: whatsappTemplateExigente.payload.data.toString('utf8'),
        whatsappTemplateFormal: whatsappTemplateFormal.payload.data.toString('utf8'),
        whatsappTemplateAmistoso: whatsappTemplateAmistoso.payload.data.toString('utf8'),
        whatsappTemplateSos: whatsappTemplateSos.payload.data.toString('utf8')
    };
}

/**
 * Construye el prompt para el Asistente de OpenAI con los datos de la factura.
 */
function buildPrompt(invoice, config) {
    const getVal = (value, fallback) => value || fallback;
    return `Crea un mensaje de cobranza para esta factura:
- Empresa que cobra: ${getVal(invoice.Cobrador_si_Grupo_Oblicua_SAS_no_es_el_cobrador_final, config.razon_social)}
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

/**
 * Llama al Asistente de OpenAI y espera su respuesta en formato JSON.
 */
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

/**
 * Envía un correo electrónico a través de la API de Campaign Monitor.
 */
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

/**
 * Envía un mensaje de WhatsApp usando una plantilla de Meta.
 */
async function sendWhatsAppMessage(token, phoneNumberId, recipientPhoneNumber, templateName, components) {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const payload = {
        messaging_product: "whatsapp",
        to: recipientPhoneNumber,
        type: "template",
        template: {
            name: templateName,
            language: { code: "es_CO" },
            components: components
        }
    };
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    await axios.post(url, payload, { headers });
    console.log(`Mensaje de WhatsApp enviado a ${recipientPhoneNumber} exitosamente.`);
}

/**
 * Reemplaza los placeholders de una plantilla (ej: {{1}}) con valores reales.
 */
function renderTemplate(templateString, params) {
    let message = templateString;
    params.forEach((param, index) => {
        const placeholder = new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g');
        message = message.replace(placeholder, param || '');
    });
    return message;
}


/**
 * Acorta un mensaje para que no exceda los 160 caracteres para un SMS.
 */
async function shortenForSms(message) {
    const prompt = `Acorta el siguiente mensaje a menos de 160 caracteres para un SMS. Sé conciso y mantén el link de pago si existe. Mensaje original: "${message}"`;
    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0].message.content;
}

/**
 * Envía un registro de la acción a la API de Billy.
 */
async function postToBilly(billyToken, payload) {
    const url = '[https://damp-dawn-69908-08d523d79e5b.herokuapp.com/api/create-bulk-entries](https://damp-dawn-69908-08d523d79e5b.herokuapp.com/api/create-bulk-entries)';
    await axios.post(url, payload, {
        headers: { 'token': billyToken, 'Content-Type': 'application/json' }
    });
    console.log('Información enviada a Billy exitosamente.');
}

/**
 * Construye el payload dinámico para la API de registro de Billy.
 */
function buildBillyPayload(channelName, invoiceData, taskConfig, message, amount) {
    console.log(`Construyendo payload para Billy con el canal: ${channelName}`);
    let channelId = 0;
    let cmId = '';
    switch (channelName.toUpperCase()) {
        case 'EMAIL': case 'TEMPLATE': channelId = 1; cmId = 'email_msg'; break;
        case 'SMS': channelId = 2; cmId = 'sms_msg'; break;
        case 'WHATSAPP': channelId = 3; cmId = 'whatsapp_msg'; break;
    }

    let etapa = 1;
    const etapaActual = invoiceData.Etapa_actual?.toUpperCase();
    if (etapaActual === "JURIDICA") etapa = 2;
    else if (etapaActual === "EXTRAJURIDICA") etapa = 3;

    const formatDate = (dateString) => {
        if (!dateString) return new Date().toISOString().split('T')[0];
        return new Date(dateString).toISOString().split('T')[0];
    };

    return {
        clients: [{
            name: invoiceData.Razón_social_cliente,
            email: invoiceData.email_Cliente?.toLowerCase() || '',
            billy_user: taskConfig.billy_user
        }],
        invoices: [{
            number: invoiceData['No._Factura'] || String(invoiceData.__ROW_NUMBER__),
            due_date: formatDate(invoiceData.Fecha_de_vencimiento),
            etapa: etapa,
            days_outstanding: parseInt(invoiceData.Días_en_Mora, 10) || 0,
            amount: String(amount),
            message: message || ""
        }],
        records: [{
            billy_user: parseInt(taskConfig.billy_user, 10),
            channel: channelId,
            date: new Date().toISOString().split('T')[0],
            cm_id: cmId
        }]
    };
}

// --- Función Principal ---

functions.http('processAndSendMessage', async (req, res) => {
    const { invoiceData, taskConfig } = req.body;
    const ASSISTANT_ID = 'asst_56YtrqC8wtBXx7lZMl6aMyK2';
    const SENDER_EMAIL = 'no-reply@cobrosautomaticos.com';
    const CAMPAIGN_MONITOR_CLIENT_ID = '254000907423a7e16351ee3ac9d373ef';
    const WHATSAPP_PHONE_NUMBER_ID_DEFAULT = '506361355901323';
    const WHATSAPP_PHONE_NUMBER_ID_SOS = '526134037258358';

    if (!(parseInt(invoiceData.Días_en_Mora, 10) > 0 || invoiceData.Monto)) {
        console.log(`Factura ${invoiceData['No._Factura']} omitida por filtro.`);
        return res.status(200).send({ status: 'skipped', reason: 'Filter not met' });
    }

    try {
        const apiKeys = await getApiKeys();
        const prompt = buildPrompt(invoiceData, taskConfig);
        const gptResponse = await callAssistant(prompt, ASSISTANT_ID);
        const { type, subject, msg, amount, tone } = gptResponse;
        
        let billyPayload = {};

        switch (type.toUpperCase()) {
            case 'EMAIL':
            case 'TEMPLATE': {
                const senderName = taskConfig.razon_social || "Tu Empresa";
                let htmlToSend;

                if (type.toUpperCase() === 'EMAIL') {
                    htmlToSend = msg;
                } else {
                    htmlToSend = taskConfig.tonos.con_plantilla.html_content;
                    if (!htmlToSend) throw new Error("No se encontró el contenido HTML de la plantilla en taskConfig.");
                }
                const recipientEmail = taskConfig.isTest ? taskConfig.test_email : invoiceData.email_Cliente;
                await sendCampaignMonitorEmail(apiKeys.campaignKey, CAMPAIGN_MONITOR_CLIENT_ID, senderName, SENDER_EMAIL, recipientEmail, subject, htmlToSend);
                billyPayload = buildBillyPayload(type, invoiceData, taskConfig, null, amount);
                break;
            }
            case 'SMS': {
                const shortMessage = await shortenForSms(msg);
                const countryCode = invoiceData.Indicativo_Cel_Cliente || '57';
                const phone = taskConfig.isTest ? taskConfig.test_phone : invoiceData.Cel_Cliente;
                const smsUrl = `https://api.sms.to/sms/send?api_key=${apiKeys.smsKey}&to=+${countryCode}${phone}&message=${encodeURIComponent(shortMessage)}&sender_id=oblicua`;
                await axios.post(smsUrl);
                billyPayload = buildBillyPayload(type, invoiceData, taskConfig, shortMessage, amount);
                break;
            }
            case 'WHATSAPP': {
                if (!invoiceData.Cel_Cliente) {
                    return res.status(200).send({ status: 'skipped', reason: 'No WhatsApp number' });
                }
                console.log(`Enviando por WhatsApp con tono: ${tone}`);
                let templateName, templateToRender, components, paramsForBilly;
                let tokenToSend, phoneIdToSend;
                const emailDestino = taskConfig.isTest ? taskConfig.test_email : invoiceData.email_Cliente;
                const telefonoDestino = taskConfig.isTest ? taskConfig.test_phone : invoiceData.Cel_Cliente;

                if (String(taskConfig.billy_user) === '20') {
                    console.log('Usando configuración especial para SOS Jurídico (usuario 20)...');
                    tokenToSend = apiKeys.whatsappSosToken;
                    phoneIdToSend = WHATSAPP_PHONE_NUMBER_ID_SOS;
                    // Se usa el nombre de la plantilla de SOS Jurídico
                    templateName = 'amistoso';
                    templateToRender = apiKeys.whatsappTemplateSos;
                    const cobradorFinal = invoiceData.Cobrador_si_Grupo_Oblicua_SAS_no_es_el_cobrador_final || taskConfig.razon_social;
                    paramsForBilly = [invoiceData.Razón_social_cliente, cobradorFinal];
                    components = [{ type: "header", parameters: [{ type: "text", text: "¡Mensaje importante de SOS Jurídico!" }] }, { type: "body", parameters: paramsForBilly.map(p => ({ type: "text", text: p })) }];
                } else {
                    console.log('Usando configuración de WhatsApp principal...');
                    tokenToSend = apiKeys.whatsappToken;
                    phoneIdToSend = WHATSAPP_PHONE_NUMBER_ID_DEFAULT;
                    const cleanTone = tone.toLowerCase();
                    if (cleanTone === 'exigente') {
                        templateName = 'exigente';
                        templateToRender = apiKeys.whatsappTemplateExigente;
                        paramsForBilly = [invoiceData['No._Factura'], taskConfig.razon_social, String(invoiceData.Monto), emailDestino, telefonoDestino];
                        components = [{ type: "header", parameters: [{ type: "text", text: "NO VEMOS REFLEJADO SU PAGO" }] }, { type: "body", parameters: paramsForBilly.map(p => ({ type: "text", text: p })) }];
                    } else if (cleanTone === 'formal') {
                        templateName = 'formal';
                        templateToRender = apiKeys.whatsappTemplateFormal;
                        paramsForBilly = [invoiceData.Razón_social_cliente, invoiceData['No._Factura'], taskConfig.razon_social, telefonoDestino, emailDestino];
                        components = [{ type: "header", parameters: [{ type: "text", text: `¡Mensaje importante de ${taskConfig.razon_social}!` }] }, { type: "body", parameters: paramsForBilly.map(p => ({ type: "text", text: p })) }];
                    } else if (cleanTone === 'amigable' || cleanTone === 'amistoso') {
                        templateName = 'amistoso';
                        templateToRender = apiKeys.whatsappTemplateAmistoso;
                        paramsForBilly = [msg, telefonoDestino, emailDestino];
                        components = [{ type: "body", parameters: paramsForBilly.map(p => ({ type: "text", text: p })) }];
                    } else {
                        throw new Error(`Tono de WhatsApp no reconocido: ${tone}`);
                    }
                }
                const countryCode = invoiceData.Indicativo_Cel_Cliente || '57';
                const phone = taskConfig.isTest ? taskConfig.test_whatsapp : invoiceData.Cel_Cliente;
                const fullPhoneNumber = `${countryCode}${phone}`;
                await sendWhatsAppMessage(tokenToSend, phoneIdToSend, fullPhoneNumber, templateName, components);
                const messageToSendToBilly = renderTemplate(templateToRender, paramsForBilly);
                billyPayload = buildBillyPayload('WHATSAPP', invoiceData, taskConfig, messageToSendToBilly, amount);
                break;
            }
            default:
                console.log(`Tipo de mensaje desconocido: ${type}`);
                return res.status(200).send({ status: 'skipped', reason: 'Unknown message type' });
        }
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



¡Esta es una actualización masiva y crítica! El código ha pasado de una prueba de concepto básica a una implementación completa de la lógica de negocio, incluyendo la integración profunda de WhatsApp con plantillas de Meta y una lógica de registro mucho más detallada.

⚠️ Resumen de Cambios Críticos
Integración WhatsApp Completa: Se agregaron helpers para renderTemplate, sendWhatsAppMessage, y varias claves nuevas de Secret Manager (tokens y plantillas de WhatsApp).

Lógica de Tono en WhatsApp: La función ahora implementa lógica condicional para seleccionar la plantilla correcta (exigente, formal, amistoso) y un caso especial para SOS Jurídico (billy_user 20).

Registro Centralizado: El payload de registro de Billy (buildBillyPayload) se ha expandido con campos vitales como due_date, etapa y cm_id, y se ha movido a una función auxiliar limpia.

Nuevos Secretos: Se agregaron cinco nuevos secretos relacionados con WhatsApp.

Estructura del Output: El Output de la IA (gptResponse) ahora incluye el campo tone, que es esencial para la lógica de WhatsApp.

Aquí tienes el archivo Markdown completo con todas las correcciones, listo para reemplazar el contenido de tu archivo docs/funciones/process-and-send-message.md.

Archivo: docs/funciones/process-and-send-message.md (Actualizado)
Markdown

---
id: process-and-send-message
title: 🤖 process-and-send-message (Lógica Central de Envío)
sidebar_label: Procesar y Enviar
---

# Función `process-and-send-message`

Esta función Cloud Run es el **Handler Final** del `Billy-workflow` y el componente más complejo de la arquitectura. Su rol es orquestar la **Inteligencia Artificial (OpenAI)** para generar el mensaje, seleccionar el canal de envío **multi-tono** (Email, SMS, WhatsApp) y registrar la acción en el sistema de *analytics* de Billy.

## 1. Detalles de Despliegue

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Tipo** | Cloud Run Service (Node.js) | Función HTTP invocada por el loop del Workflow. |
| **Región GCP** | `northamerica-south1` | Mismo *datacenter* que el Workflow. |
| **URL de Invocación** | `https://process-and-send-message-985640295677.northamerica-south1.run.app` | **Endpoint privado**. |
| **Autenticación** | Requiere **IAM** | Solo invocable por la Cuenta de Servicio del `Billy-workflow`. |
| **Dependencias Externas** | **OpenAI (GPT & Asistente), Meta/WhatsApp API, Campaign Monitor, sms.to.** | Se requiere un amplio acceso a múltiples APIs de terceros. |

## 2. Flujo de Procesamiento y Lógica de Negocio

El flujo central ahora incluye una **lógica de ramificación avanzada** para WhatsApp basada en el tono de cobro:

### A. Lógica de Tono y Canal

1.  **Filtro Inicial:** Se omite si no hay días en mora o monto.
2.  **Generación de Mensaje (OpenAI):** El Asistente de OpenAI determina el **canal (`type`)** y el **tono (`tone`)** de la comunicación. El output incluye un JSON con `type`, `subject`, `msg`, `amount`, y `tone`.
3.  **EMAIL / TEMPLATE:** Usa Campaign Monitor. Permite usar el contenido generado por IA (`EMAIL`) o una plantilla HTML predefinida (`TEMPLATE`).
4.  **SMS:** Usa la función `shortenForSms` (llamada a GPT-3.5-turbo) para garantizar que el mensaje no exceda los 160 caracteres antes de enviarlo por la API de `sms.to`.
5.  **WHATSAPP:**
    * Utiliza el token y las plantillas de la API de Meta, extraídas de Secret Manager.
    * La lógica selecciona la plantilla correcta (`exigente`, `formal`, `amistoso`) basándose en el campo `tone` devuelto por la IA.
    * Incluye una **lógica especial para el usuario 20 (SOS Jurídico)**, utilizando tokens y plantillas específicos para ese flujo.

### B. Registro de la Acción

* Se utiliza la función `buildBillyPayload` para estandarizar el registro con los campos **`etapa`**, **`due_date`**, **`days_outstanding`**, y el **`channel`** adecuado (`channelId: 1` para Email, `2` para SMS, `3` para WhatsApp).
* La acción se registra en la API de Billy **solo si no es un modo de prueba**.

## 3. Código Fuente (Node.js)

```javascript title="index.js"
const functions = require('@google-cloud/functions-framework');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const OpenAI = require('openai');
const axios = require('axios');

const secretClient = new SecretManagerServiceClient();
let openai;

// --- Funciones Auxiliares ---

/**
 * Obtiene todas las claves de API y plantillas de texto necesarias desde Secret Manager.
 * (Actualizada para incluir las 5 claves/plantillas de WhatsApp)
 * @returns {Promise<object>} Un objeto con todas las claves y plantillas.
 */
async function getApiKeys() {
    const [openaiKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/openai-api-key/versions/latest' });
    const [campaignKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/campaign-monitor-api-key/versions/latest' });
    const [smsKey] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/smsto-api-key/versions/latest' });
    const [billyToken] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/billy-api-token/versions/latest' });
    const [whatsappToken] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-api-token/versions/latest' });
    const [whatsappSosToken] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-billy-sos-api-token/versions/latest' });
    const [whatsappTemplateExigente] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-template-exigente/versions/latest' });
    const [whatsappTemplateFormal] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-template-formal/versions/latest' });
    const [whatsappTemplateAmistoso] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-template-amistoso/versions/latest' });
    const [whatsappTemplateSos] = await secretClient.accessSecretVersion({ name: 'projects/billy-473802/secrets/whatsapp-template-sos-juridico/versions/latest' });

    openai = new OpenAI({ apiKey: openaiKey.payload.data.toString('utf8') });
    return {
        campaignKey: campaignKey.payload.data.toString('utf8'),
        smsKey: smsKey.payload.data.toString('utf8'),
        billyToken: billyToken.payload.data.toString('utf8'),
        whatsappToken: whatsappToken.payload.data.toString('utf8'),
        whatsappSosToken: whatsappSosToken.payload.data.toString('utf8'),
        whatsappTemplateExigente: whatsappTemplateExigente.payload.data.toString('utf8'),
        whatsappTemplateFormal: whatsappTemplateFormal.payload.data.toString('utf8'),
        whatsappTemplateAmistoso: whatsappTemplateAmistoso.payload.data.toString('utf8'),
        whatsappTemplateSos: whatsappTemplateSos.payload.data.toString('utf8')
    };
}

/**
 * Construye el prompt para el Asistente de OpenAI con los datos de la factura.
 */
function buildPrompt(invoice, config) {
    const getVal = (value, fallback) => value || fallback;
    return `Crea un mensaje de cobranza para esta factura:
- Empresa que cobra: ${getVal(invoice.Cobrador_si_Grupo_Oblicua_SAS_no_es_el_cobrador_final, config.razon_social)}
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

/**
 * Llama al Asistente de OpenAI y espera su respuesta en formato JSON.
 */
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

/**
 * Envía un correo electrónico a través de la API de Campaign Monitor.
 */
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

/**
 * Envía un mensaje de WhatsApp usando una plantilla de Meta.
 */
async function sendWhatsAppMessage(token, phoneNumberId, recipientPhoneNumber, templateName, components) {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const payload = {
        messaging_product: "whatsapp",
        to: recipientPhoneNumber,
        type: "template",
        template: {
            name: templateName,
            language: { code: "es_CO" },
            components: components
        }
    };
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    await axios.post(url, payload, { headers });
    console.log(`Mensaje de WhatsApp enviado a ${recipientPhoneNumber} exitosamente.`);
}

/**
 * Reemplaza los placeholders de una plantilla (ej: {{1}}) con valores reales.
 */
function renderTemplate(templateString, params) {
    let message = templateString;
    params.forEach((param, index) => {
        const placeholder = new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g');
        message = message.replace(placeholder, param || '');
    });
    return message;
}


/**
 * Acorta un mensaje para que no exceda los 160 caracteres para un SMS.
 */
async function shortenForSms(message) {
    const prompt = `Acorta el siguiente mensaje a menos de 160 caracteres para un SMS. Sé conciso y mantén el link de pago si existe. Mensaje original: "${message}"`;
    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0].message.content;
}

/**
 * Envía un registro de la acción a la API de Billy.
 */
async function postToBilly(billyToken, payload) {
    const url = '[https://damp-dawn-69908-08d523d79e5b.herokuapp.com/api/create-bulk-entries](https://damp-dawn-69908-08d523d79e5b.herokuapp.com/api/create-bulk-entries)';
    await axios.post(url, payload, {
        headers: { 'token': billyToken, 'Content-Type': 'application/json' }
    });
    console.log('Información enviada a Billy exitosamente.');
}

/**
 * Construye el payload dinámico para la API de registro de Billy.
 */
function buildBillyPayload(channelName, invoiceData, taskConfig, message, amount) {
    console.log(`Construyendo payload para Billy con el canal: ${channelName}`);
    let channelId = 0;
    let cmId = '';
    switch (channelName.toUpperCase()) {
        case 'EMAIL': case 'TEMPLATE': channelId = 1; cmId = 'email_msg'; break;
        case 'SMS': channelId = 2; cmId = 'sms_msg'; break;
        case 'WHATSAPP': channelId = 3; cmId = 'whatsapp_msg'; break;
    }

    let etapa = 1;
    const etapaActual = invoiceData.Etapa_actual?.toUpperCase();
    if (etapaActual === "JURIDICA") etapa = 2;
    else if (etapaActual === "EXTRAJURIDICA") etapa = 3;

    const formatDate = (dateString) => {
        if (!dateString) return new Date().toISOString().split('T')[0];
        return new Date(dateString).toISOString().split('T')[0];
    };

    return {
        clients: [{
            name: invoiceData.Razón_social_cliente,
            email: invoiceData.email_Cliente?.toLowerCase() || '',
            billy_user: taskConfig.billy_user
        }],
        invoices: [{
            number: invoiceData['No._Factura'] || String(invoiceData.__ROW_NUMBER__),
            due_date: formatDate(invoiceData.Fecha_de_vencimiento),
            etapa: etapa,
            days_outstanding: parseInt(invoiceData.Días_en_Mora, 10) || 0,
            amount: String(amount),
            message: message || ""
        }],
        records: [{
            billy_user: parseInt(taskConfig.billy_user, 10),
            channel: channelId,
            date: new Date().toISOString().split('T')[0],
            cm_id: cmId
        }]
    };
}

// --- Función Principal ---

functions.http('processAndSendMessage', async (req, res) => {
    const { invoiceData, taskConfig } = req.body;
    const ASSISTANT_ID = 'asst_56YtrqC8wtBXx7lZMl6aMyK2';
    const SENDER_EMAIL = 'no-reply@cobrosautomaticos.com';
    const CAMPAIGN_MONITOR_CLIENT_ID = '254000907423a7e16351ee3ac9d373ef';
    const WHATSAPP_PHONE_NUMBER_ID_DEFAULT = '506361355901323';
    const WHATSAPP_PHONE_NUMBER_ID_SOS = '526134037258358';

    if (!(parseInt(invoiceData.Días_en_Mora, 10) > 0 || invoiceData.Monto)) {
        console.log(`Factura ${invoiceData['No._Factura']} omitida por filtro.`);
        return res.status(200).send({ status: 'skipped', reason: 'Filter not met' });
    }

    try {
        const apiKeys = await getApiKeys();
        const prompt = buildPrompt(invoiceData, taskConfig);
        const gptResponse = await callAssistant(prompt, ASSISTANT_ID);
        const { type, subject, msg, amount, tone } = gptResponse;
        
        let billyPayload = {};

        switch (type.toUpperCase()) {
            case 'EMAIL':
            case 'TEMPLATE': {
                const senderName = taskConfig.razon_social || "Tu Empresa";
                let htmlToSend;

                if (type.toUpperCase() === 'EMAIL') {
                    htmlToSend = msg;
                } else {
                    htmlToSend = taskConfig.tonos.con_plantilla.html_content;
                    if (!htmlToSend) throw new Error("No se encontró el contenido HTML de la plantilla en taskConfig.");
                }
                const recipientEmail = taskConfig.isTest ? taskConfig.test_email : invoiceData.email_Cliente;
                await sendCampaignMonitorEmail(apiKeys.campaignKey, CAMPAIGN_MONITOR_CLIENT_ID, senderName, SENDER_EMAIL, recipientEmail, subject, htmlToSend);
                billyPayload = buildBillyPayload(type, invoiceData, taskConfig, null, amount);
                break;
            }
            case 'SMS': {
                const shortMessage = await shortenForSms(msg);
                const countryCode = invoiceData.Indicativo_Cel_Cliente || '57';
                const phone = taskConfig.isTest ? taskConfig.test_phone : invoiceData.Cel_Cliente;
                const smsUrl = `https://api.sms.to/sms/send?api_key=${apiKeys.smsKey}&to=+${countryCode}${phone}&message=${encodeURIComponent(shortMessage)}&sender_id=oblicua`;
                await axios.post(smsUrl);
                billyPayload = buildBillyPayload(type, invoiceData, taskConfig, shortMessage, amount);
                break;
            }
            case 'WHATSAPP': {
                if (!invoiceData.Cel_Cliente) {
                    return res.status(200).send({ status: 'skipped', reason: 'No WhatsApp number' });
                }
                console.log(`Enviando por WhatsApp con tono: ${tone}`);
                let templateName, templateToRender, components, paramsForBilly;
                let tokenToSend, phoneIdToSend;
                const emailDestino = taskConfig.isTest ? taskConfig.test_email : invoiceData.email_Cliente;
                const telefonoDestino = taskConfig.isTest ? taskConfig.test_phone : invoiceData.Cel_Cliente;

                if (String(taskConfig.billy_user) === '20') {
                    console.log('Usando configuración especial para SOS Jurídico (usuario 20)...');
                    tokenToSend = apiKeys.whatsappSosToken;
                    phoneIdToSend = WHATSAPP_PHONE_NUMBER_ID_SOS;
                    // Se usa el nombre de la plantilla de SOS Jurídico
                    templateName = 'amistoso';
                    templateToRender = apiKeys.whatsappTemplateSos;
                    const cobradorFinal = invoiceData.Cobrador_si_Grupo_Oblicua_SAS_no_es_el_cobrador_final || taskConfig.razon_social;
                    paramsForBilly = [invoiceData.Razón_social_cliente, cobradorFinal];
                    components = [{ type: "header", parameters: [{ type: "text", text: "¡Mensaje importante de SOS Jurídico!" }] }, { type: "body", parameters: paramsForBilly.map(p => ({ type: "text", text: p })) }];
                } else {
                    console.log('Usando configuración de WhatsApp principal...');
                    tokenToSend = apiKeys.whatsappToken;
                    phoneIdToSend = WHATSAPP_PHONE_NUMBER_ID_DEFAULT;
                    const cleanTone = tone.toLowerCase();
                    if (cleanTone === 'exigente') {
                        templateName = 'exigente';
                        templateToRender = apiKeys.whatsappTemplateExigente;
                        paramsForBilly = [invoiceData['No._Factura'], taskConfig.razon_social, String(invoiceData.Monto), emailDestino, telefonoDestino];
                        components = [{ type: "header", parameters: [{ type: "text", text: "NO VEMOS REFLEJADO SU PAGO" }] }, { type: "body", parameters: paramsForBilly.map(p => ({ type: "text", text: p })) }];
                    } else if (cleanTone === 'formal') {
                        templateName = 'formal';
                        templateToRender = apiKeys.whatsappTemplateFormal;
                        paramsForBilly = [invoiceData.Razón_social_cliente, invoiceData['No._Factura'], taskConfig.razon_social, telefonoDestino, emailDestino];
                        components = [{ type: "header", parameters: [{ type: "text", text: `¡Mensaje importante de ${taskConfig.razon_social}!` }] }, { type: "body", parameters: paramsForBilly.map(p => ({ type: "text", text: p })) }];
                    } else if (cleanTone === 'amigable' || cleanTone === 'amistoso') {
                        templateName = 'amistoso';
                        templateToRender = apiKeys.whatsappTemplateAmistoso;
                        paramsForBilly = [msg, telefonoDestino, emailDestino];
                        components = [{ type: "body", parameters: paramsForBilly.map(p => ({ type: "text", text: p })) }];
                    } else {
                        throw new Error(`Tono de WhatsApp no reconocido: ${tone}`);
                    }
                }
                const countryCode = invoiceData.Indicativo_Cel_Cliente || '57';
                const phone = taskConfig.isTest ? taskConfig.test_whatsapp : invoiceData.Cel_Cliente;
                const fullPhoneNumber = `${countryCode}${phone}`;
                await sendWhatsAppMessage(tokenToSend, phoneIdToSend, fullPhoneNumber, templateName, components);
                const messageToSendToBilly = renderTemplate(templateToRender, paramsForBilly);
                billyPayload = buildBillyPayload('WHATSAPP', invoiceData, taskConfig, messageToSendToBilly, amount);
                break;
            }
            default:
                console.log(`Tipo de mensaje desconocido: ${type}`);
                return res.status(200).send({ status: 'skipped', reason: 'Unknown message type' });
        }
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