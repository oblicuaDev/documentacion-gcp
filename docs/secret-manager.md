---
id: secret-manager
title: 🔑 Gestión de Secretos (Secret Manager)
sidebar_label: Secret Manager
---

# Gestión de Secretos en Billy GCP

**Google Cloud Secret Manager** es el servicio centralizado para almacenar todas las claves de API, *tokens* de acceso y credenciales sensibles utilizadas por Billy. Esto garantiza que la información sensible nunca esté *hardcodeada* en el código fuente ni expuesta en variables de entorno.

## 1. Convención de Nomenclatura para Credenciales de Cliente

Las credenciales de los sistemas de facturación de terceros se almacenan bajo una convención estricta que permite al **`Billy-workflow`** construir la ruta de acceso de forma dinámica:

**Formato:** `[servicio-minúsculas]-[billy_user]-credentials`

| Segmento | Descripción | Ejemplo de Valor (Ver imagen: `siigo-302-credentials`) |
| :--- | :--- | :--- |
| `servicio-minúsculas` | Plataforma de facturación (ej. `siigo`, `cuenti`, `allegra`). | `siigo` |
| `billy_user` | Identificador único del cliente de Oblicua. | `302` o `21` |
| **Secreto Resultante** | `siigo-302-credentials` |  |

## 2. Listado de Secretos Centrales y su Uso

Se han añadido los secretos necesarios para la integración avanzada con **WhatsApp (API de Meta)** y las plantillas de mensaje asociadas.

| Nombre del Secreto | Uso Principal | Función que lo Utiliza |
| :--- | :--- | :--- |
| **`openai-api-key`** | Clave de acceso a la API de **OpenAI** (Generación de tono y contenido). | `process-and-send-message` |
| **`billy-api-token`** | Token para autenticarse en la **API de Registro de Billy** (*analytics*). | `process-and-send-message` |
| **`google-sheets-credentials`** | Cuenta de Servicio con permisos de solo lectura para Google Sheets. | `get-data-from-sheets` |
| **`campaign-monitor-api-key`** | Clave para enviar correos electrónicos transaccionales. | `process-and-send-message` |
| **`smsto-api-key`** | Clave para el envío de mensajes SMS. | `process-and-send-message` |
| **`whatsapp-api-token`** | Token de acceso a la API principal de **Meta/WhatsApp**. | `process-and-send-message` |
| **`whatsapp-billy-sos-api-token`** | Token especial para el flujo de **SOS Jurídico** (Usuario 20). | `process-and-send-message` |
| **`whatsapp-template-exigente`** | Contenido de la plantilla para el tono exigente. | `process-and-send-message` |
| **`whatsapp-template-formal`** | Contenido de la plantilla para el tono formal. | `process-and-send-message` |
| **`whatsapp-template-amistoso`** | Contenido de la plantilla para el tono amistoso/amigable. | `process-and-send-message` |
| **`whatsapp-template-sos-juridico`** | Contenido de la plantilla para el caso especial de SOS Jurídico. | `process-and-send-message` |

## 3. Flujo de Vida de una Credencial

1. **Creación:** El *frontend* del usuario envía las credenciales de un tercero a la función **`save-user-credentials`**.
2. **Almacenamiento:** `save-user-credentials` crea o actualiza el secreto en Secret Manager bajo la convención `[servicio]-[usuario]-credentials`.
3. **Acceso:** El **`Billy-workflow`** recupera el secreto llamando a la API de Secret Manager, utilizando la Cuenta de Servicio del Workflow (que debe tener el rol **`Secret Manager Secret Accessor`**).
4. **Uso:** El Workflow pasa el valor del secreto (el *payload* de la credencial) a la función de adaptación correspondiente (`get-data-from-siigo`, etc.) a través del cuerpo de la petición HTTP.
