import type { components, operations } from './schema'

export type PublicationCard = components['schemas']['PublicationCard']
export type AnalysisResult = components['schemas']['AnalysisResult']
export type PublicationDetail = components['schemas']['PublicationDetail']
export type PublicationList = components['schemas']['PublicationList']
export type RegulatoryCase = components['schemas']['RegulatoryCase']
export type RegulatoryCaseDetail = components['schemas']['RegulatoryCaseDetail']
export type LifecycleEvent = components['schemas']['LifecycleEvent']
export type Source = components['schemas']['Source']
export type ApiErrorBody = components['schemas']['Error']
export type Category = components['schemas']['Category']
export type Priority = components['schemas']['Priority']
export type SourceType = components['schemas']['SourceType']
export type PublicationQuery = NonNullable<
  operations['listPublications']['parameters']['query']
>
