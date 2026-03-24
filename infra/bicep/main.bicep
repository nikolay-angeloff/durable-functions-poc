targetScope = 'resourceGroup'

@description('Azure region for resources.')
param location string = resourceGroup().location

@description('Short name prefix (letters and numbers only, lowercase).')
@minLength(3)
@maxLength(12)
param baseName string = 'durabledemo'

@description('Publisher email for API Management (required by APIM resource).')
param apimPublisherEmail string = 'admin@example.com'

@description('Deploy API Management (can take 30–45 minutes on first deploy).')
param deployApim bool = true

@description('Public URL of the SPA for correction resume emails (WEB_APP_BASE_URL). No trailing slash. Leave empty to use https://<deployed Static Web App default hostname>.')
param webAppBaseUrl string = ''

var suffix = uniqueString(resourceGroup().id, baseName)
var storageName = toLower(take('st${baseName}${suffix}', 24))
var funcAppName = '${baseName}-func-${suffix}'
// JSON array for FUNCTIONS host CORS (Linux Consumption often ignores Portal/siteConfig.cors for preflight).
var corsAllowedOriginsJson = '["https://${swa.properties.defaultHostname}","https://${swaMonitor.properties.defaultHostname}","http://localhost:5173","http://127.0.0.1:5173"]'
var sbNamespaceName = '${baseName}-sb-${suffix}'
var swaName = '${baseName}-swa-${suffix}'
var swaMonitorName = '${baseName}-monswa-${suffix}'
var apimName = '${baseName}-apim-${suffix}'
var lawName = '${baseName}-law-${suffix}'

resource law 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: lawName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-ai-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${baseName}-plan-${suffix}'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
  kind: 'linux'
}

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: sbNamespaceName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {}
}

resource queueAzure 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'form-azure'
  properties: {
    maxDeliveryCount: 10
  }
}

resource queueM365 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'form-m365'
  properties: {
    maxDeliveryCount: 10
  }
}

resource queueCorrectionNeeded 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'correction-needed'
  properties: {
    maxDeliveryCount: 10
  }
}

resource sbAuth 'Microsoft.ServiceBus/namespaces/authorizationRules@2022-10-01-preview' existing = {
  parent: serviceBusNamespace
  name: 'RootManageSharedAccessKey'
}

var serviceBusConnectionString = sbAuth.listKeys().primaryConnectionString

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: funcAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(funcAppName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'ServiceBusConnection'
          value: serviceBusConnectionString
        }
        {
          name: 'SENDGRID_API_KEY'
          value: ''
        }
        {
          name: 'SENDGRID_FROM_EMAIL'
          value: 'noreply@example.com'
        }
        {
          name: 'FUNCTIONS_ENABLE_CORS_CONFIGURATION'
          value: '1'
        }
        {
          name: 'CORS_ALLOWED_ORIGINS'
          value: corsAllowedOriginsJson
        }
        {
          name: 'CORS_SUPPORT_CREDENTIALS'
          value: 'false'
        }
        {
          name: 'CORS_ALLOW_ORIGIN'
          value: '*'
        }
        {
          name: 'WEB_APP_BASE_URL'
          value: webAppBaseUrl != '' ? webAppBaseUrl : 'https://${swa.properties.defaultHostname}'
        }
      ]
    }
  }
}

resource swa 'Microsoft.Web/staticSites@2022-03-01' = {
  name: swaName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
  }
}

/** Separate SPA for Durable orchestration monitor (only UI; calls same Function API). */
resource swaMonitor 'Microsoft.Web/staticSites@2022-03-01' = {
  name: swaMonitorName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
  }
}

resource apim 'Microsoft.ApiManagement/service@2022-08-01' = if (deployApim) {
  name: apimName
  location: location
  sku: {
    name: 'Developer'
    capacity: 1
  }
  properties: {
    publisherEmail: apimPublisherEmail
    publisherName: 'Durable Demo'
  }
}

resource demoApi 'Microsoft.ApiManagement/service/apis@2022-08-01' = if (deployApim) {
  parent: apim
  name: 'demo-api'
  properties: {
    displayName: 'Demo API'
    path: ''
    protocols: [
      'https'
    ]
    serviceUrl: 'https://${functionApp.properties.defaultHostName}/api'
    subscriptionRequired: false
  }
}

resource demoApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2022-08-01' = if (deployApim) {
  parent: demoApi
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: '''
<policies>
  <inbound>
    <cors allow-credentials="false">
      <allowed-origins>
        <origin>*</origin>
      </allowed-origins>
      <allowed-methods>
        <method>POST</method>
        <method>OPTIONS</method>
      </allowed-methods>
      <allowed-headers>
        <header>*</header>
      </allowed-headers>
    </cors>
    <base />
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
'''
  }
}

resource submitOperation 'Microsoft.ApiManagement/service/apis/operations@2022-08-01' = if (deployApim) {
  parent: demoApi
  name: 'submit'
  properties: {
    displayName: 'Submit form'
    method: 'POST'
    urlTemplate: '/submit'
  }
}

output functionAppName string = functionApp.name
output functionAppHost string = functionApp.properties.defaultHostName
output staticWebAppName string = swa.name
output staticWebAppHostname string = swa.properties.defaultHostname
output staticWebAppMonitorName string = swaMonitor.name
output staticWebAppMonitorHostname string = swaMonitor.properties.defaultHostname
output serviceBusNamespace string = serviceBusNamespace.name
output apimGatewayUrl string = deployApim ? 'https://${apimName}.azure-api.net' : ''
output apimSubmitUrl string = deployApim ? 'https://${apimName}.azure-api.net/submit' : ''
output applicationInsightsConnectionString string = appInsights.properties.ConnectionString
