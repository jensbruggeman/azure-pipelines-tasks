import * as tl from "azure-pipelines-task-lib/task";
import * as auth from "./Authentication";
import { getSystemAccessToken, ProtocolType } from "../locationUtilities";
import { getPackagingServiceInfo, PackagingUriPrefix } from "../locationUtilities2";
import { GetExternalAuthInfoArray } from "./CommandHelper";

const CRED_PROVIDER_PREFIX_ENVVAR = "VSS_NUGET_URI_PREFIXES";
const CRED_PROVIDER_ACCESS_TOKEN_ENVVAR = "VSS_NUGET_ACCESSTOKEN";
const CRED_PROVIDER_EXTERNAL_ENDPOINTS_ENVVAR = "VSS_NUGET_EXTERNAL_FEED_ENDPOINTS";
const NO_API_CONNECTIONS_LINK = "https://"; // TODO

interface EndpointCredentials {
    endpoint: string;
    username?: string;
    password: string;
}
interface EndpointCredentialsContainer {
    endpointCredentials: EndpointCredentials[];
}

export async function configureCredProvider() {
    await configureCredProviderForSameOrganizationFeeds();
    configureCredProviderForServiceConnectionFeeds();
}

export function configureNuGetPluginPaths(credProviderAssemblyPath: string) {
    tl.setVariable("NUGET_PLUGIN_PATHS", credProviderAssemblyPath);
}

async function configureCredProviderForSameOrganizationFeeds() {
    const serviceData = await getPackagingServiceInfo(ProtocolType.NuGet);
    const accessToken = getSystemAccessToken();

    // To avoid confusion, by default only show the public access mapping URIs rather than all of them (e.g. host guid access mapping)
    // which we should support, yet users are extremely unlikely to ever use
    const publicPrefixes: string[] = [...new Set(serviceData.UriPrefixes.filter(prefix => prefix.IsPublic).map(prefix => prefix.UriPrefix))];
    console.log(`Setting up the credential provider to use the identity '${serviceData.AuthenticatedUser.customDisplayName || serviceData.AuthenticatedUser.providerDisplayName}' for feeds in your organization/collection starting with:`);
    publicPrefixes.forEach(x => console.log('  ' + x));
    console.log();

    const allPrefixes: string[] = [...new Set(serviceData.UriPrefixes.map(prefix => prefix.UriPrefix))];
    tl.setVariable(CRED_PROVIDER_PREFIX_ENVVAR, allPrefixes.join(";"));
    tl.setVariable(CRED_PROVIDER_ACCESS_TOKEN_ENVVAR, accessToken, false); // Even though this is a secret, we need the environment variable to be set
}

function configureCredProviderForServiceConnectionFeeds() {
    const externalAuthItems = GetExternalAuthInfoArray("externalEndpoints");
    if (externalAuthItems && externalAuthItems.length) {
        console.log(`Setting up the credential provider for these service connection URIs:`)
        // Would be nice to also emit the service connection name, but we only have the ID and it wasn't obvious how to get the name
        externalAuthItems.map(authInfo => `${authInfo.packageSource.feedUri}`).forEach(x => console.log('  ' + x));
        console.log();

        const externalFeedEndpointsJson = buildExternalFeedEndpointsJson(externalAuthItems);
        tl.setVariable(CRED_PROVIDER_EXTERNAL_ENDPOINTS_ENVVAR, externalFeedEndpointsJson, false); // Even though this contains secrets, we need the environment variable to be set
        // TODO zarenner: Debug logging will potentially expose these! What can we do about that? Ideally there'd be a setVariable that keeps it secret for logs, but still sets the envvar
    }
}

// Similar to the older NuGetToolRunner2.buildCredentialJson,
// but this one fails hard on ApiKey based service connections instead of silently continuing.
function buildExternalFeedEndpointsJson(externalAuthInfos: auth.ExternalAuthInfo[]): string {
    const endpointCredentialsContainer: EndpointCredentialsContainer = {
        endpointCredentials: [] as EndpointCredentials[]
    };

    if (!externalAuthInfos || !externalAuthInfos.length) {
        return null;
    }

    externalAuthInfos.forEach((authInfo) => {
        switch(authInfo.authType) {
            case (auth.ExternalAuthType.UsernamePassword):
                const usernamePasswordAuthInfo = authInfo as auth.UsernamePasswordExternalAuthInfo;
                endpointCredentialsContainer.endpointCredentials.push({
                    endpoint: authInfo.packageSource.feedUri,
                    username: usernamePasswordAuthInfo.username,
                    password: usernamePasswordAuthInfo.password
                    
                });
                tl.debug(`Detected username/password credentials for '${authInfo.packageSource.feedUri}'`);
                break;
            case (auth.ExternalAuthType.Token):
                const tokenAuthInfo = authInfo as auth.TokenExternalAuthInfo;
                endpointCredentialsContainer.endpointCredentials.push({
                    endpoint: authInfo.packageSource.feedUri,
                    /* No username provided */
                    password: tokenAuthInfo.token
                } as EndpointCredentials);
                tl.debug(`Detected token credentials for '${authInfo.packageSource.feedUri}'`);
                break;
            default:
                // e.g. ApiKey based service connections are not supported and cause a hard failure in the NuGetAuthenticate task
                throw Error(`The service connection for '${authInfo.packageSource.feedUri}' is not valid. Note that ApiKey service connections are not supported in this task, please see ${NO_API_CONNECTIONS_LINK}`)
        }
    });

    return JSON.stringify(endpointCredentialsContainer);
}