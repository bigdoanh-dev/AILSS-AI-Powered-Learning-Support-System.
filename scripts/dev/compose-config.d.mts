export function localComposeConfig(
  profile: string,
  exists?: (file: string) => boolean,
): { media: boolean; args: string[] };
