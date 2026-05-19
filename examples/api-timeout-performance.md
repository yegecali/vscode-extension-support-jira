---
id: api-timeout-performance
label: Timeout / Rendimiento Lento de API
classification: PERFORMANCE_ISSUE
---

## Diagnóstico de Timeout / API Lenta

Un ticket es un **problema de rendimiento/timeout** si:

1. **Los endpoints de API responden lentamente** (>2s) o devuelven timeout
2. El error menciona: `504 Gateway Timeout`, `request timeout`, `took longer than 30s`, `ECONNRESET`
3. **Clientes perciben latencia**: Las páginas cargan lentamente, las operaciones se atascan
4. El problema puede ser **intermitente** (a ciertas horas del día)

### Síntomas Típicos

- `504 Gateway Timeout` → la aplicación backend tardó >30s en responder
- `ECONNRESET` → la conexión se cerró inesperadamente
- "El dashboard tarda 10 segundos en cargar"
- Usuarios reportan que la app "está congelada"
- Logs muestran `latency: 45000ms` para una query que normalmente tarda 500ms

### Información Clave a Recopilar

- **URL exacta** o **endpoint** afectado (`GET /api/reports`, etc.)
- **Timing**: ¿A qué hora ocurrió? ¿Es consistente o intermitente?
- **Volumen de usuarios**: ¿Afecta a todos o solo a algunos?
- **Historial**: ¿Cuándo empezó? ¿Desde un deploy? ¿Gradualmente?
- **Datos/parámetros**: ¿Sucede con ciertos usuarios, proyectos, o rangos de fechas?
- **Traces**: Si hay aplicación APM (New Relic, DataDog), obtén el trace ID

### Acciones de Diagnóstico

1. **Verifica latencia por endpoint en Grafana**:
   - Dashboard `api-latency`
   - Busca el endpoint específico
   - ¿Hay un spike visible en ese momento?
   - Compara percentiles: p50, p95, p99

2. **Revisa logs de aplicación en Kibana**:
   ```
   level: ERROR OR WARN AND (timeout OR latency OR slow) 
   AND timestamp: [rango del reporte]
   ```
   - ¿Qué está tardando? ¿Una query a BD? ¿Una llamada externa?

3. **Identifica el cuello de botella**:
   - Si es **a BD**: Ve a diagnóstico de BD (ver ejemplo `database-connection-error`)
   - Si es **a servicio externo**: Verifica la latencia de ese servicio (ej: Stripe, SendGrid)
   - Si es **CPU/memoria**: Mira métricas de la instancia (`cpu_usage`, `memory_usage`)

4. **Analiza queries lentas** (si es BD):
   ```sql
   SELECT query, calls, mean_time 
   FROM pg_stat_statements 
   ORDER BY mean_time DESC 
   LIMIT 10;
   ```
   - Una query que tarda 15s es el culpable
   - Busca si le falta un índice

5. **Monitorea dependencias externas**:
   - ¿El timeout coincide con un pico en las llamadas a Stripe/SendGrid/etc.?
   - Contacta al proveedor si algo anda mal en su lado

6. **Verifica la carga del servidor**:
   ```
   cpu_usage > 80% AND timestamp: [rango]
   ```
   - Si CPU está al 100%, la aplicación puede estar saturada
   - Mira si hay procesos rogue o memory leaks

### Acciones Correctivas

- **Si es una query lenta**: Agrega un índice o optimiza la query
- **Si es CPU alta**: Escala horizontalmente (más instancias) o revisa qué proceso consume CPU
- **Si es volumen de tráfico**: Implementa caching (Redis) o CQRS para lecturas
- **Si es un servicio externo lento**: Implementa timeout y reintentos, o busca proveedor alternativo

### Ejemplo: Troubleshooting Rápido

```
1. Endpoint GET /api/reports?project_id=123 tarda 45s
2. Grafana muestra latencia normal (p99 = 800ms) → El spike es reciente
3. Kibana logs muestran que la BD está retrasada
4. psql: SELECT COUNT(*) FROM reports; → 5 millones de filas!
5. Solución: Agregar índice en project_id
```

### Escalada

- **Backend/API**: Si la aplicación es el cuello de botella
- **DBA**: Si el problema es en BD (query lenta, índice faltante)
- **DevOps**: Si hay saturación de CPU/RAM o problema de infraestructura
- **Proveedor externo**: Si un servicio de terceros (Stripe, etc.) está lento
