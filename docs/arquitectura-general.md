---
id: arquitectura-general
title: 🗺️ Arquitectura General del Sistema Billy
sidebar_label: 🗺️ Arquitectura General
---

# Arquitectura General del Sistema Billy GCP

El proyecto Billy es una plataforma de **mensajería de cobranza asíncrona** construida sobre **Google Cloud Platform (GCP)**, diseñada para inyectar inteligencia artificial (IA) y flexibilidad de canal en el proceso de notificación de facturas.

La arquitectura se basa en un modelo **serverless** y de **orquestación centralizada** a través de Cloud Workflows.

## Flujo de Procesamiento General

El sistema opera en tres fases principales: **Ingesta**, **Orquestación** y **Procesamiento/Envío**.

### 1. Ingesta (Punto de Entrada)

El proceso comienza cuando un usuario del *frontend* de Oblicua inicia una tarea de cobro.

| Componente | Responsabilidad |
| :--- | :--- |
| **`ingest-task-from-billy`** | Es el **endpoint público** de la UI. Recibe el payload de la tarea (usuario, plataforma, filtros) e inmediatamente inicia el Cloud Workflow, devolviendo una respuesta 202 (Accepted). |
| **CORS/Seguridad** | Configurado para aceptar peticiones solo desde el dominio de Oblicua. |

### 2. Orquestación Central (Cloud Workflows)

El `Billy-workflow` es el cerebro que coordina todas las acciones.

| Componente | Responsabilidad |
| :--- | :--- |
| **`Billy-workflow`** | 1. **Determina la Plataforma** de origen (Siigo, Cuenti, Sheets). 2. **Obtiene Credenciales** de Secret Manager. 3. **Invoca el Adaptador de Datos** (`get-data-from-*`). 4. **Itera** sobre cada factura obtenida. 5. **Invoca** `process-and-send-message` para cada factura. |
| **Adaptadores de Datos** | **`get-data-from-sheets`**, **`get-data-from-cuenti`**, **`get-data-from-siigo`**. Transforman datos de formatos de terceros al esquema interno de Billy. |
| **Manejo de Errores** | El *workflow* maneja errores de procesamiento *por factura*, asegurando que una factura fallida no detenga el envío de las demás. |

### 3. Procesamiento y Envío (Lógica de Negocio)

Esta fase contiene la inteligencia y la decisión final sobre el mensaje.

| Componente | Responsabilidad |
| :--- | :--- |
| **`process-and-send-message`** | **Núcleo de la Lógica:** 1. **Genera Tono y Contenido** usando el Asistente de OpenAI (determina si es EMAIL, SMS, WHATSAPP, o TEMPLATE). 2. **Ejecuta el Envío** a través de las APIs externas (Campaign Monitor, sms.to, etc.). 3. **Registra la Acción** en la API de *analytics* de Billy. |
| **`save-user-credentials`** | **Endpoint de Seguridad.** Almacena credenciales sensibles de terceros (Siigo/Cuenti tokens) en Secret Manager de forma segura, bajo una clave única por usuario. |

## Diagrama Lógico Simplificado

Para ilustrar el flujo de control y la interacción de los servicios, el sistema sigue una arquitectura
de orquestación impulsada por el frontend del usuario.

Flujo de Billy GCP: Orquestación Serverless

El proceso de cobro se divide en tres etapas críticas, gestionadas por el Billy-workflow:

| Paso | Componente de Orquestación | Invocaciones Clave | Responsabilidad |
| :--- | :--- | :--- | :--- |
| I. INGESTA | ingest-task-from-billy (Cloud Run) | Billy-workflow | Es el punto de entrada que valida la petición del frontend de Oblicua y lanza la ejecución del workflow principal. |
| II. DATOS Y TRANSFORMACIÓN | Billy-workflow (Switch) | Secret Manager & get-data-from-* | Identifica la fuente (Siigo, Cuenti, Sheets), obtiene las credenciales de Secret Manager e invoca el adaptador de datos correspondiente. El adaptador devuelve las facturas en el esquema estándar de Billy. |
| III. PROCESAMIENTO Y ENVÍO | Billy-workflow (Loop) | process-and-send-message | Itera sobre cada factura. La función llamada inyecta IA, decide el tono y canal (EMAIL, SMS, WHATSAPP) y ejecuta el envío final. |

Flujo de Ejecución Detallado (Etapa III)

La función de envío es el corazón de la lógica de negocio y depende de múltiples APIs externas:

1. Activación: El Billy-workflow llama a -> process-and-send-message (por cada factura).
2. Inteligencia Artificial: La función llama a -> OpenAI para generar el mensaje y determinar el canal.
3. Registro y Envío: La función ejecuta:
    * -> Campaign Monitor (para Correo Electrónico).
    * -> sms.to (para SMS/WhatsApp).
    * -> API de Registro de Billy (para guardar el log de la acción).