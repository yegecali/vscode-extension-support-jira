---
id: auth-login-failure
label: Fallo de Autenticación / Login
classification: AUTHENTICATION_ERROR
---

## Diagnóstico de Fallo de Autenticación

Un ticket es un **fallo de autenticación** si:

1. **Los usuarios no pueden iniciar sesión** en la plataforma o aplicación
2. El error menciona palabras clave como: `login fallido`, `autenticación rechazada`, `credenciales inválidas`, `sesión expirada`, `token inválido`
3. El problema afecta al servicio de **API de autenticación** o **Auth0/OIDC**

### Información Clave a Buscar

- **Request ID** del intento de login fallido (en logs o navegador)
- **Error exacto**: ¿Qué dice el mensaje? ¿`401 Unauthorized`? ¿`403 Forbidden`?
- **Zona horaria y timestamp** del evento
- **Usuario o email** afectado (o si es global)
- **Cliente/navegador** usado (Chrome, Firefox, Safari, mobile app?)
- **Endpoint** que falla: `/api/auth/login`, `/oauth/token`, etc.

### Acciones Recomendadas

1. **Verifica Auth0/Cognito**: Accede al dashboard del proveedor de identidad
   - Busca logs de autenticación con el Request ID del usuario
   - Comprueba si hay errores de configuración CORS o redirect URIs

2. **Revisa los logs de API**: En Kibana, busca errores de autenticación:
   ```
   service: auth-api AND status_code: 401 AND timestamp: [rango_de_tiempo]
   ```

3. **Comprueba el estado de la base de datos de usuarios**: ¿El usuario existe? ¿Su cuenta está bloqueada?

4. **Valida los secrets y variables de entorno**:
   - ¿JWT_SECRET está configurado correctamente?
   - ¿Las credenciales de Auth0/Cognito son válidas?

5. **Monitorea Grafana**: Ve al dashboard de métricas de autenticación
   - Busca picos en `authentication_failures` o `login_attempts`
   - Compara con el período normal para detectar anomalías

### Escalada

Si después de estos pasos el error persiste:
- Contacta al equipo de **Infraestructura** si sospechas un problema con Auth0
- Contacta al equipo de **Backend/API** si es un fallo en nuestro servicio de autenticación
- Crea un ticket en el proyecto `INFRA` si hay que revisar certificados SSL o configuración de red
