---
id: db-connection-failure
label: Error de Conexión a Base de Datos
classification: DATABASE_ERROR
grafanaDashboard: /d/postgres-metrics/?var-instance=prod
kibanaDashboard: /app/discover#/?_a=(query:(match_phrase:(component:database)))
---

## Diagnóstico de Error de Conexión a Base de Datos

Un ticket describe un **error de conexión a BD** si:

1. **La aplicación no puede conectarse a PostgreSQL/MySQL/MongoDB**
2. El error contiene: `connection refused`, `connection timeout`, `too many connections`, `pool exhausted`, `FATAL: remaining connection slots are reserved`
3. Los servicios que dependen de BD fallan (API endpoints devuelven 500, tasks no se ejecutan)
4. El problema afecta a **múltiples usuarios o toda la aplicación**

### Síntomas Típicos

- `ERROR: too many connections to the database` → el pool está saturado
- `ERROR: connection timeout after 30s` → la BD no responde
- `ECONNREFUSED 127.0.0.1:5432` → el servidor no está escuchando
- `FATAL: role "app_user" does not exist` → credenciales incorrectas
- `ERROR: server closed the connection unexpectedly` → la BD se reinició o desconectó

### Información Clave a Recopilar

- **Timestamp exacto** del error
- **Número de conexiones activas** (consultar a DBA)
- **Logs de BD**: `/var/log/postgresql/postgresql.log` o CloudWatch Logs
- **Métricas de CPU/RAM** de la instancia de BD en ese momento
- **Cambios recientes**: ¿Se redeployó algo? ¿Se cambió la configuración?
- **Afectados**: ¿Qué servicios/usuarios? ¿Solo escritura o también lectura?

### Acciones de Diagnóstico

1. **Comprueba el estado del servidor**:
   ```bash
   psql -h [HOST] -U [USER] -d [DB] -c "SELECT version();"
   ```
   Si devuelve algo, la BD está arriba.

2. **Cuenta conexiones activas**:
   ```sql
   SELECT count(*) FROM pg_stat_activity;
   ```
   Compáralo con `max_connections` en la configuración.

3. **Revisa conexiones por aplicación**:
   ```sql
   SELECT application_name, count(*) 
   FROM pg_stat_activity 
   GROUP BY application_name;
   ```
   ¿Una aplicación está hoarding conexiones?

4. **Verifica el pool de conexiones**:
   - ¿Está configurado correctamente en la app? (ej: max_pool_size=20)
   - ¿Hay queries colgadas que no liberan conexiones?
   ```sql
   SELECT * FROM pg_stat_activity 
   WHERE state = 'idle in transaction';
   ```

5. **Monitorea en Grafana**:
   - Dashboard `postgres-metrics`: busca `connections`, `query latency`, `CPU`
   - Compara con el período normal
   - ¿Hay una query que está bloqueando a otras?

### Acciones Correctivas

- **Si hay muchas conexiones idle**: Mata las conexiones colgadas (con cuidado)
  ```sql
  SELECT pg_terminate_backend(pid) 
  FROM pg_stat_activity 
  WHERE state = 'idle in transaction' 
  AND query_start < now() - interval '10 minutes';
  ```

- **Si la BD se quedó sin memoria**: Reinicia el servidor (con downtime planeado)

- **Si el problema es el pool**: Aumenta `max_pool_size` en la configuración de la app, redeploy

- **Si hay un lock de tabla**: Identifica qué query lo causa e investiga
  ```sql
  SELECT * FROM pg_locks 
  WHERE NOT granted;
  ```

### Escalada

- **DBA**: Si necesitas cambios de configuración o mantenimiento de BD
- **DevOps/Infra**: Si el servidor está down o hay problemas de red/firewall
- **Backend**: Si la app no libera conexiones correctamente (posible memory leak)
