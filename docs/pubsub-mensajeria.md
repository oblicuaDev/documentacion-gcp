---
id: pubsub-mensajeria
title: 📬 Esquema y Contrato de Datos
sidebar_label: Esquema de Datos
---

# Esquema y Contrato de Datos de Billy

Aunque el flujo central de Billy se maneja mediante orquestación HTTP (Cloud Workflows a Cloud Run), la uniformidad de los datos se rige por un **Esquema Estándar de Mensajería**. Este esquema es el **contrato de datos** que todos los adaptadores (`get-data-from-*`) deben generar.

## 1. Esquema de la Factura Estándar

El *payload* de cada factura procesada y pasada al `Billy-workflow` (en la variable `invoices`) debe coincidir con esta estructura.

| Campo | Tipo | Descripción | Ejemplo |
| :--- | :--- | :--- | :--- |
| `No._Factura` | String | Identificador único de la factura en el sistema de origen. | `"FV-3-60"` |
| `Monto` | Number | Monto total pendiente de cobro. | `150000.50` |
| `Días_en_Mora` | Number | Número de días que la factura lleva vencida (puede ser negativo si no ha vencido). | `18` |
| `Fecha_de_vencimiento` | String | Fecha de vencimiento, formato `YYYY-MM-DD`. | `"2025-10-30"` |
| `Razón_social_cliente` | String | Nombre del cliente o razón social. | `"Cliente Ejemplo SAS"` |
| `email_Cliente` | String | Correo electrónico principal del destinatario. | `"contacto@cliente.com"` |
| `Cel_Cliente` | String | Número de teléfono (usado para SMS/WhatsApp). | `"3001234567"` |
| `Indicativo_Cel_Cliente` | String | Código de país para el celular. | `"57"` |
| `__ROW_NUMBER__` | Number (Opcional) | Número de fila original si la fuente es Google Sheets. | `24` |

## 2. Payload de Ejemplo (JSON)

Este es el formato JSON que las funciones de transformación (`get-data-from-cuenti`, etc.) deben producir:

```json title="Ejemplo de Factura Estandarizada"
{
  "No._Factura": "FAC-SIIGO-456",
  "Monto": 500000,
  "Días_en_Mora": 45,
  "Fecha_de_vencimiento": "2025-08-30",
  "Razón_social_cliente": "Compañía Alpha",
  "email_Cliente": "cobro@alpha.com",
  "Cel_Cliente": "3109876543",
  "Indicativo_Cel_Cliente": "57"
}
```

## 3. Temas de Pub/Sub (Registro)

Aunque los datos no fluyen por Pub/Sub en el workflow central, si se utilizara un sistema de logging asíncrono o de registro de eventos, se utilizarían los siguientes temas:
   * billy-events: Registro de eventos de alto nivel (ej. "Se completó la ejecución del workflow", "El adaptador X falló").
   * billy-audit-log: Registro detallado de cada acción de envío (ej. "SMS enviado a 3001234567").