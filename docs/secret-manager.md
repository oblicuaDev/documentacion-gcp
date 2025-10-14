---
id: secret-manager
title: 🔑 Gestión de Secretos (Secret Manager)
sidebar_label: Secret Manager
---

# Gestión de Secretos en Billy GCP

**Google Cloud Secret Manager** es el servicio centralizado para almacenar todas las claves de API, *tokens* de acceso y credenciales sensibles utilizadas por Billy. Esto garantiza que la información sensible nunca esté *hardcodeada* en el código fuente ni expuesta en variables de entorno.

## 1. Convención de Nomenclatura para Credenciales de Cliente

Las credenciales de los sistemas de facturación de terceros (Siigo, Cuenti, Allegra) se almacenan bajo una convención estricta que permite al **`Billy-workflow`** construir la ruta de acceso de forma dinámica:

**Formato:** `[servicio-minúsculas]-[billy_user]-credentials`

| Segmento | Descripción | Ejemplo de Valor |
| :--- | :--- | :--- |
| `servicio-minúsculas` | Plataforma de facturación (ej. `siigo`, `cuenti`, `allegra`). | `siigo` |
| `billy_user` | Identificador único del cliente de Oblicua. | `prueba` |
| **Secreto Resultante** | `siigo-prueba-credentials` |

## 2. Listado de Secretos Centrales y su Uso

Los siguientes secretos son **estáticos** y contienen las claves de las APIs de envío y utilidades internas del sistema.

| Nombre del Secreto | Uso Principal | Función que lo Utiliza |
| :--- | :--- | :--- |
| **`openai-api-key`** | Clave de acceso a la API de **OpenAI** (para generación de tono y contenido de mensajes). | `process-and-send-message` |
| **`campaign-monitor-api-key`** | Clave para enviar correos electrónicos transaccionales. | `process-and-send-message` |
| **`smsto-api-key`** | Clave para el envío de mensajes SMS/WhatsApp. | `process-and-send-message` |
| **`billy-api-token`** | Token para autenticarse en la **API de Registro de Billy** (*analytics*). | `process-and-send-message` |
| **`google-sheets-credentials`** | Cuenta de Servicio con permisos de solo lectura para acceder a las matrices de Google Sheets de los clientes. | `get-data-from-sheets` |

## 3. Flujo de Vida de una Credencial

1.  **Creación:** El *frontend* del usuario envía las credenciales de un tercero a la función **`save-user-credentials`**.
2.  **Almacenamiento:** `save-user-credentials` crea o actualiza el secreto en Secret Manager bajo la convención `[servicio]-[usuario]-credentials`.
3.  **Acceso:** El **`Billy-workflow`** recupera el secreto llamando a la API de Secret Manager, utilizando la Cuenta de Servicio del Workflow (que debe tener el rol **`Secret Manager Secret Accessor`**).
4.  **Uso:** El Workflow pasa el valor del secreto (el *payload* de la credencial) a la función de adaptación correspondiente (`get-data-from-siigo`, etc.) a través del cuerpo de la petición HTTP.