import { createExpoPushProvider } from './src/push';
import { query } from './src/db';

interface DeviceInstallationRow extends Record<string, unknown> {
  installation_id: string;
  push_token: string | null;
}

async function main() {
  const provider = createExpoPushProvider();
  const message = {
    title: 'Prueba de Push',
    body: 'Esto es una prueba de que las notificaciones conectan bien tras el arreglo de red',
    data: { test: true },
  };

  const installations = await query<DeviceInstallationRow>(
    'SELECT installation_id, push_token FROM device_installations WHERE active = TRUE'
  );

  const notifications = installations
    .filter((installation) => installation.push_token)
    .map((installation) => ({
      installationId: installation.installation_id,
      pushToken: installation.push_token as string,
      title: message.title,
      body: message.body,
      data: message.data,
    }));

  const result = await provider.send(notifications);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
