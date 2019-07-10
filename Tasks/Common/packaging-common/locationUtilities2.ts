import { ConnectOptions } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { AccessMapping } from 'azure-devops-node-api/interfaces/LocationsInterfaces';
import * as tl from 'azure-pipelines-task-lib/task';
import {
    ProtocolType,
    getSystemAccessToken,
    getAreaIdForProtocol,
    getServiceUriFromAreaId,
    getWebApiWithProxy
} from './locationUtilities';
import { Identity } from 'azure-devops-node-api/interfaces/IdentitiesInterfaces';

export interface PackagingServiceInfo {
    AuthenticatedUser: Identity;
    UriPrefixes: PackagingUriPrefix[];
}

export interface PackagingUriPrefix {
    UriPrefix: string;
    IsPublic: boolean;
    IsDefault: boolean;
}

/*
 Similar to the older getPackagingUris, but:
    1. Correctly gets the HostGuidAccessMapping by appending the virtual directory (e.g. https://pkgsprodscussu1.pkgs.visualstudio.com/A6c704a24-19ae-46e3-9cfd-28783939bb06/ instead of https://pkgsprodscussu1.pkgs.visualstudio.com/)
    2. Provides information about if the access mappings / prefix uris are "public" (either the default public access mapping, or a well-known public access mapping)
    3. Also gets the build identity

 Consider merging this with getPackagingUris at a time with lower risk of breaking existing tasks.
*/
export async function getPackagingServiceInfo(protocolType: ProtocolType): Promise<PackagingServiceInfo> {
    tl.debug('Getting Packaging service access points');
    
    const tfsCollectionUrl = tl.getVariable('System.TeamFoundationCollectionUri');
    const accessToken = getSystemAccessToken();
    const areaId = getAreaIdForProtocol(protocolType);

    const serviceUri = await getServiceUriFromAreaId(tfsCollectionUrl, accessToken, areaId);

    const webApi = getWebApiWithProxy(serviceUri, accessToken);
    const locationApi = await webApi.getLocationsApi();

    tl.debug(`Acquiring connection data from ${serviceUri}`);
    const connectionData = await locationApi.getConnectionData(ConnectOptions.IncludeServices);
    
    tl.debug('Successfully acquired the connection data');

    // Both forms of the public access mapping, e.g. https://pkgs.dev.azure.com/{organization}/ and https://{organization}.pkgs.visualstudio.com/
    const commonAccessMappings = ['CodexAccessMapping', 'VstsAccessMapping'];

    const packagingUriPrefixes: PackagingUriPrefix[] = connectionData.locationServiceData.accessMappings.map(accessMapping => {
        let isDefaultAccessMapping = accessMapping.moniker === connectionData.locationServiceData.defaultAccessMappingMoniker;
        let isCommonAccessMapping = commonAccessMappings.indexOf(accessMapping.moniker) > -1;
        return {
            UriPrefix: toPackagingUriPrefix(accessMapping),
            IsPublic: isDefaultAccessMapping || isCommonAccessMapping,
            IsDefault: isDefaultAccessMapping
        }
    });

    return {
        AuthenticatedUser: connectionData.authenticatedUser,
        UriPrefixes: packagingUriPrefixes
    };
}

function toPackagingUriPrefix(accessMapping: AccessMapping): string {
    if (!accessMapping.virtualDirectory) {
        return accessMapping.accessPoint;
    }

    return ensureTrailingSlash(ensureTrailingSlash(accessMapping.accessPoint) + accessMapping.virtualDirectory);
}

function ensureTrailingSlash(uri: string) {
    return uri.endsWith("/") ? uri : uri + "/";
}