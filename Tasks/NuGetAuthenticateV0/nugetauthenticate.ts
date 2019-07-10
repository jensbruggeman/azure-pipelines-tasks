import * as tl from "azure-pipelines-task-lib/task";
import * as nugetUtils from "packaging-common/nuget/Utility";
import * as credProviderUtilities from "packaging-common/nuget/CredentialProviderUtilities"

async function main(): Promise<void> {
    try {
        await credProviderUtilities.configureCredProvider();

        // This task uses the .exe variant of the credprovider
        const credProviderAssemblyPath = nugetUtils.locateCredentialProvider(true);
        console.log(`Configuring nuget.exe and MSBuild (.NET Framework) to use the credential provider`);
        credProviderUtilities.configureNuGetPluginPaths(credProviderAssemblyPath);
    } catch (error) {
        // TODO: Call tl.error and then a generic message in setResult?
        tl.setResult(tl.TaskResult.Failed, error.message);
    }
}

main();