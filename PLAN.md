# PLAN — Screening OFAC de wallets en QvaPay y Trondealer

Integrar el API de este repo (`ofac-sdn`) como control de sanciones **antes de cualquier envío de fondos a una wallet externa**. En caso de match: QvaPay bloquea la wallet y notifica a compliance; Trondealer aborta el proceso. Como defensa adicional, Trondealer importa la lista completa a su blacklist local (SQL incluido en `data/trondealer-ofac-blacklist.sql`).

---

## 1. El contrato del API

```
GET {OFAC_API_URL}/api?address=<wallet>
```

- Match **exacto, case-insensitive** (importante en ETH, donde el casing es solo checksum). No hay fuzzy: una dirección coincide o no.
- Cubre ~940 direcciones únicas en 15+ monedas (BTC, ETH, TRX, USDT, LTC, XMR, SOL…), extraídas de las features "Digital Currency Address" del SDN Enhanced XML.

**Respuesta con match** (`total > 0` ⇒ wallet sancionada):

```jsonc
{
  "query": "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
  "total": 1,
  "results": [{
    "score": 100,
    "matchedAddress": "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
    "currency": "ETH",
    "entity": {
      "id": "27307",
      "type": "Entity",
      "programs": ["DPRK3"],          // programa de sanciones — guardarlo en el log
      "sanctionsTypes": ["Block"],
      "names": [{ "full": "LAZARUS GROUP", ... }]
    }
  }],
  "tookMs": 4
}
```

**Sin match**: `{ "total": 0, "results": [] }`. **Errores**: `400` (falta el param), `500` (dataset inaccesible) — tratar cualquier ≠200 como "no pude verificar", nunca como "está limpia".

**Regla de decisión**: `total > 0` → bloquear. `total == 0` → continuar. Error/timeout → ver política de fallos (§4).

### Direcciones de prueba

| Caso | Dirección | Esperado |
|---|---|---|
| ETH sancionada (Lazarus Group) | `0x098B716B8Aaf21512996dC57EB0615e2383E2f96` | `total: 1` |
| Misma en mayúsculas | `0X098B716B8AAF21512996DC57EB0615E2383E2F96` | `total: 1` |
| TRX sancionada (Bank Markazi, Irán) | `TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81` | `total: 1` |
| Limpia (cualquier wallet propia de test) | — | `total: 0` |

---

## 2. QvaPay

### Dónde enganchar

Dos puntos de control, no uno:

1. **Al registrar/guardar una wallet de retiro** (alta o edición de dirección por el usuario) — atajar temprano evita que el usuario acumule saldo que luego no puede retirar.
2. **Al ejecutar el retiro/envío** (justo antes de firmar/transmitir la transacción) — es el control que cuenta legalmente; la lista pudo actualizarse después del registro.

### Implementación

- [ ] Crear `OfacScreeningService` con un método `screen(address): ScreeningResult` que llama `GET {OFAC_API_URL}/api?address=...` con **timeout de 3 s y 1 reintento**.
- [ ] Config: `OFAC_API_URL` en `.env` (apuntar al deployment de Vercel de `ofac-sdn`).
- [ ] En el flujo de retiro, si `total > 0`:
  - [ ] **Rechazar la transacción** (estado `blocked_sanctions`, nunca `failed` genérico — compliance necesita distinguirlo).
  - [ ] **Bloquear la wallet**: marcar la dirección en BD (`wallets.blocked_at`, `blocked_reason = 'OFAC_SDN'`, guardar `entity.id`, nombre primario y `programs` del response).
  - [ ] **Congelar reintentos**: la wallet bloqueada no puede reutilizarse en otro retiro ni ser editada por el usuario para "limpiarla".
  - [ ] **Notificar a compliance**: correo + canal interno (Slack/Telegram del equipo) con: usuario (id + KYC name), dirección, moneda, entidad OFAC matcheada, programas, monto que se intentó enviar, timestamp. Este registro es el que se usa si hay que reportar.
  - [ ] **Auditar**: fila en tabla `sanctions_screenings` (se consultó qué dirección, cuándo, resultado, respuesta cruda) — también para los "no match". OFAC puede pedir evidencia de que el screening ocurría.
- [ ] Mensaje al usuario: genérico ("no pudimos procesar este retiro, contacta soporte"). **No revelar** que fue un match de sanciones — evita tip-off y que prueben variantes.
- [ ] **Screening retroactivo** (one-shot): correr todas las wallets ya registradas contra el API y bloquear/notificar los matches existentes. Un script que itere `withdrawal_wallets` y llame al API alcanza (~1 req por wallet, el API responde en ms).

### Extra recomendado (mismo API, costo casi cero)

El API también hace fuzzy matching de **nombres** (`?name=...`). QvaPay tiene nombres KYC — un screening del nombre al completar KYC (score ≥ 85 → revisión manual) cierra el otro flanco de OFAC. No es requisito de este plan, pero es la siguiente iteración natural.

---

## 3. Trondealer

### Dónde enganchar

En el pipeline de cada operación, **antes de transmitir cualquier transacción TRON** (TRX o USDT-TRC20): screening de la dirección destino. Si hay match → **abortar el proceso completo** (no continuar con pasos posteriores, no reintentar automáticamente).

### Implementación — doble capa

**Capa 1 — blacklist local (siempre disponible, sin red):**

- [ ] Importar `data/trondealer-ofac-blacklist.sql` (ver §5) en la tabla existente `"public"."blacklist"` — suma las 940 direcciones OFAC a las ~90 que ya tiene.
- [ ] Check en el flujo: `SELECT 1 FROM blacklist WHERE LOWER(wallet) = LOWER(:destino) LIMIT 1`. La comparación debe ser **case-insensitive** (en ETH el casing es solo checksum; hoy la tabla tiene la misma 0x… guardada con casings distintos).
- [ ] Recomendado: `CREATE INDEX idx_blacklist_wallet_lower ON blacklist (LOWER(wallet));` para que ese lookup sea O(log n) y, cuando dedupliques las filas repetidas que ya existen, convertirlo en `UNIQUE`.

**Capa 2 — API en vivo (datos frescos):**

- [ ] Mismo `GET ?address=` que QvaPay, timeout 3 s. Cubre la ventana entre actualizaciones de la tabla local.

**En match (cualquiera de las dos capas):**

- [ ] Abortar el proceso con estado explícito (`aborted_sanctions`).
- [ ] Registrar el intento (dirección, entidad, monto, operación) en log/BD.
- [ ] Si la dirección vino del API pero no estaba en la tabla local, insertarla (self-healing de la blacklist).

**Mantenimiento:**

- [ ] Cron (diario o semanal) que regenera e importa el SQL tras cada `npm run import:upload` en `ofac-sdn`, o que sincroniza contra el JSON de R2. El SQL es idempotente (`NOT EXISTS` case-insensitive) — re-ejecutarlo es seguro y no duplica.
- [ ] Nota: OFAC **también des-lista** entidades. La re-importación no borra filas obsoletas; una vez por mes comparar la tabla contra el dataset. Como el esquema actual no distingue origen (no hay columna `source`), las filas OFAC se identifican por el archivo generado — si esto se vuelve incómodo, agregar una columna `source` es un ALTER de una línea.

---

## 4. Política de fallos (aplica a ambos)

| Escenario | Acción |
|---|---|
| API responde `total > 0` | Bloquear (ver arriba). |
| API responde `total: 0` | Continuar. |
| API timeout / 5xx (tras 1 reintento) — **Trondealer** | Consultar blacklist local; si tampoco está → continuar es aceptable (la capa local cubre), pero loguear el fallo del API. |
| API timeout / 5xx — **QvaPay** (sin capa local) | **Fail-closed**: retener el retiro en estado `pending_review` para revisión manual. Un envío a una wallet sancionada no se puede deshacer; un retiro demorado sí se explica. |
| API caído de forma sostenida | Alertar (ver §6). QvaPay puede montar la misma tabla local que Trondealer como fallback si esto duele. |

---

## 5. SQL de importación masiva (Trondealer)

Archivo: **`data/trondealer-ofac-blacklist.sql`** (generado el 2026-07-15 desde el dataset OFAC publicado el 2026-07-15). Apunta directo al esquema real de Trondealer: **PostgreSQL, tabla `"public"."blacklist"` (`id`, `wallet`, `hits`, `created_at`)**.

- 940 direcciones únicas: XBT 522, TRX 188, ETH 96, USDT 85 y el resto (LTC, XMR, SOL, DOGE…). Se importan **todas**, no solo TRON — el lookup es por dirección y no estorba tener las demás.
- **Idempotente y no destructivo**: cada lote inserta vía `INSERT … SELECT … WHERE NOT EXISTS` con comparación `LOWER(wallet)` — no duplica las ~90 filas que ya existen ni las suyas propias si se re-ejecuta. No borra ni toca nada existente.
- `id` lo asigna la secuencia (el script incluye un `setval` que la realinea primero — el dump insertó ids explícitos y en Supabase la secuencia suele quedar detrás, lo que daría `duplicate key`). `hits` queda `NULL`; `created_at` = `NOW()`.
- Como la tabla no tiene columnas de metadata, cada dirección lleva un **comentario SQL** con moneda, entidad sancionada y programas (`-- TRX · BANK MARKAZI … [IRAN,IFSR,…]`) — el archivo sirve de referencia de auditoría.
- Direcciones EVM listadas por OFAC bajo varias redes (ETH/ARB/BSC comparten formato `0x…`) quedan deduplicadas en una sola fila.

Ejecutar en el SQL Editor de Supabase, o:

```bash
psql "$DATABASE_URL" -f data/trondealer-ofac-blacklist.sql
```

Verificación rápida post-import: `SELECT COUNT(*) FROM blacklist;` debe rondar 1030 (90 previas + 940), y `SELECT 1 FROM blacklist WHERE LOWER(wallet) = LOWER('TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81');` debe devolver fila.

---

## 6. Pendientes del lado de `ofac-sdn` (este repo)

- [ ] **Deploy a producción** — el parámetro `?address=` ya está en `main` local pero necesita deploy en Vercel para existir en producción.
- [ ] **Autenticación**: el endpoint hoy es público y sin rate-limit. Antes de que dos servicios de producción dependan de él, agregar al menos un header `x-api-key` validado contra env var, o restringirlo vía Vercel Firewall.
- [ ] **Monitoreo**: healthcheck (`?address=` con una dirección conocida, esperar `total: 1`) cada 5 min desde el monitor que ya usen (UptimeRobot/BetterStack) — si el dataset se corrompe o R2 falla, enterarse antes que QvaPay.
- [ ] **Refresco del dataset**: cron mensual (o tras cada publicación OFAC) de `npm run import:upload`. OFAC actualiza el SDN varias veces al mes; una lista vieja es un agujero de compliance. Al refrescar, regenerar también el SQL de Trondealer.

## 7. Orden sugerido de ejecución

1. Deploy de `ofac-sdn` + API key + healthcheck (§6).
2. Trondealer: importar SQL + check local (capa 1) — es lo más rápido y ya da cobertura.
3. Trondealer: capa 2 (API en vivo) + aborto y logging.
4. QvaPay: `OfacScreeningService` + bloqueo en retiro + notificación a compliance.
5. QvaPay: screening al registrar wallet + barrido retroactivo de wallets existentes.
6. Crons de refresco (dataset R2 + tabla Trondealer).
