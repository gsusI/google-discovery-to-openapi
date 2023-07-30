import { logger } from '../util/logging.js';
import { 
    resourceNameOverridesByOperationId,
    resourceNameOverridesByResourceName,
    sqlVerbOverrides,
 } from './overrides.js';

const exceptions = ['gitlab', 'github', 'dotcom'];

function camelToSnake(name) {
    // Replace exceptions in string regardless of case
    for (const exception of exceptions) {
        const regex = new RegExp(exception, 'ig'); // 'i' for case insensitive and 'g' for global
        name = name.replace(regex, exception);
    }

    // Then convert the rest to snake case
    name = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    return name.toLowerCase();
}

function getResourceNameOverrideByOperationId(service, operationId) {
    // return the resource name or false
    return resourceNameOverridesByOperationId[service] && resourceNameOverridesByOperationId[service][operationId];
}

function getResourceNameOverrideByName(service, resource) {
    // return the new resource name or the original
    const override = resourceNameOverridesByResourceName[service] && resourceNameOverridesByResourceName[service][resource];
    
    if (override) {
        return override;
    }

    return resource;
}

function getSqlVerbOverride(service, verb, operationId) {
    // return the new sql verb or the original
    const override = sqlVerbOverrides[service] && sqlVerbOverrides[service][operationId];
    
    if (override) {
        return override;
    }

    return verb;
}

function getResourceNameFromOperationId(operationId) {

    const opTokens = operationId.split('.');
    // return 2d last token
    return camelToSnake(opTokens[opTokens.length - 2]);

}

export function getMethodName(service, operationId, debug) {
    const fullyQualifiedMethodNameServices = [
        'accessapproval',
        'analyticshub',
        'apigee',
        'apigeeregistry',
        'beyondcorp',
        'bigquerydatatransfer',
        'cloudbuild',
        'container',
        'containeranalysis',
        'datacatalog',
        'dataflow',
        'datalabeling',
        'dataplex',
        'dataproc',
        'dialogflow',
        'discoveryengine',
        'dlp',
        'documentai',
        'essentialcontacts',
        'gkehub',
        'gkeonprem',
        'integrations',
        'logging',
        'ml',
        'monitoring',
        'networksecurity',
        'orgpolicy',
        'policysimulator',
        'prod_tt_sasportal',
        'pubsub',
        'pubsublite',
        'recommendationengine',
        'recommender',
        'resourcesettings',
        'retail',
        'sasportal',
        'securitycenter',
        'spanner',
        'translate',
        'videointelligence',
        'vision',
    ];

    const action = operationId.split('.')[operationId.split('.').length - 1];
    const opTokens = operationId.split('.').slice(1);

    if (fullyQualifiedMethodNameServices.includes(service)) {
        return camelToSnake(opTokens.join('_'));
    } else {
        return camelToSnake(action);
    }
}

export function getResource(service, operationId, debug){

    const action = operationId.split('.')[operationId.split('.').length - 1];

    // check for an explicit map by operationId
    if(getResourceNameOverrideByOperationId(service, operationId)){
        return [getResourceNameOverrideByOperationId(service, operationId), action];
    }

    // derive the resource name from the operationId    
    let resource = getResourceNameFromOperationId(operationId);
    
    const specialTokens = [
        'organizations', 
        'folders', 
        'projects', 
        'locations',
    ];
    const verbs = [
        'get', 
        'list',
        'delete',
        'batchGet',
        'remove',
        'create',
        'add',
        'update',
        'fetch',
        'retrieve',
    ];

    // update resource name based on action
    const processAction = (action, resource) => {
        if (['getIamPolicy', 'setIamPolicy', 'testIamPermissions', 'analyzeIamPolicy', 'analyzeIamPolicyLongrunning', 'searchAllIamPolicies'].includes(action)) {
            return `${resource}_iam_policies`;
        } 
        else {
            for (let verb of verbs) {
                if (action.startsWith(verb) && action !== verb) {
                    const suffix = camelToSnake(action.slice(verb.length));
                    if (specialTokens.includes(resource)) {
                        return `${suffix}`;
                    } else {
                        return `${resource}_${suffix}`;
                    }
                }
            }
        }
        // return original resource if no special conditions apply
        return resource;
    };
    
    resource = processAction(action, resource);

    // replace double underscores in resource name with single underscore
    resource = resource.replace(/__/g, '_');

    // resource should never start with an underscore
    if (resource.startsWith('_')) {
        resource = resource.slice(1);
    }

    // final update based upon resource name
    resource = getResourceNameOverrideByName(service, resource);

    return [resource, action];
}

function checkAdditionalProperties(moperationObj, schemasObj) {
    const schema = moperationObj.responses?.['200']?.content?.['application/json']?.schema?.['$ref'];
    const schemaObj = schemasObj[schema.split('/').pop()];

    if (schemaObj.properties) {
        const hasAdditionalProperties = Object.values(schemaObj.properties).some(field => 'additionalProperties' in field);
        return hasAdditionalProperties ? 'exec' : 'select';
    } else {
        logger.warn(`schemaObj.properties not found for ${schema}`);
        return 'exec';
    }
}

function ifStartsWithOrEquals(str, substr) {
    return str.startsWith(substr) || str === substr;
}

const googleSelectMethods = [
    'aggregatedList',
    'get',
    'list',
];

const googleInsertMethods = [
    'insert',
    'create',
];

const googleDeleteMethods = [
    'delete',
];

export function getSQLVerb(service, resource, action, operationId, httpPath, httpVerb, operationObj, schemasObj, debug) {
    
    // default sql verb to 'exec'
    let sqlVerb = 'exec';

    // console.log(`getSQLVerb: ${service} ${resource} ${action} ${operationId} ${httpVerb}`);

    // check if action equals or starts with a select method
    if (googleSelectMethods.some(method => ifStartsWithOrEquals(action, method)) && httpVerb === 'get') {
        sqlVerb = 'select';
    }

    // check if action equals or starts with an insert method
    if (googleInsertMethods.some(method => ifStartsWithOrEquals(action, method)) && httpVerb === 'post') {
        sqlVerb = 'insert';
    }

    // check if action equals or starts with a delete method
    if (googleDeleteMethods.some(method => ifStartsWithOrEquals(action, method)) && httpVerb === 'delete') {
        sqlVerb = 'delete';
    }

    // if(action === 'aggregatedList' || action.startsWith('get') || action.startsWith('list') || action.startsWith('add')){
    //     sqlVerb = httpVerb === 'get' ? 'select' : 'exec';
    // }

    // if(action.startsWith('delete')){
    //     sqlVerb = httpVerb === 'delete' ? 'delete' : 'exec';
    // }

    // if(action.startsWith('insert') || action.startsWith('create')){        
    //     sqlVerb = httpVerb === 'post' ? 'insert' : 'exec';
    // }

    // if (sqlVerb === 'delete' && action === 'removeProject') {
    //     sqlVerb = 'exec';
    // }

    // console.log(`sqlVerb before: ${sqlVerb}`)

    if(action !== 'aggregatedList' ){
        sqlVerb = sqlVerb === 'select' ? checkAdditionalProperties(operationObj, schemasObj) : sqlVerb;    
    }
    
    // console.log(`sqlVerb after checkAdditionalProperties: ${sqlVerb}`)

    // override by exception by service
    sqlVerb = getSqlVerbOverride(service, sqlVerb, operationId);

    // console.log(`sqlVerb after getSqlVerbOverride: ${sqlVerb}`)

    return sqlVerb;
}

  