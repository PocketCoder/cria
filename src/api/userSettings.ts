import { type ApiClient, callApi, createApiClient } from './client';

export interface UserSettingsInput {
  language?: string;
  timezone?: string;
}

export async function pushUserSettings(
  settings: UserSettingsInput,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/settings/general', {
      body: settings,
    }),
  );
}
