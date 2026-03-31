import * as React from 'react'
import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

function Accordion<Value>({
  className,
  ...props
}: AccordionPrimitive.Root.Props<Value> & { className?: string }): React.JSX.Element {
  return <AccordionPrimitive.Root className={cn('space-y-3', className)} {...props} />
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>): React.JSX.Element {
  return <AccordionPrimitive.Item className={cn('rounded-3xl', className)} {...props} />
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>): React.JSX.Element {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          'group/accordion flex w-full items-start justify-between gap-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30',
          className
        )}
        {...props}
      >
        {children}
        <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground transition-transform group-data-[panel-open]/accordion:rotate-90">
          <IconChevronDown className="size-4" stroke={1.8} />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Panel>): React.JSX.Element {
  return (
    <AccordionPrimitive.Panel
      className={cn('overflow-hidden data-[ending-style]:animate-out', className)}
      {...props}
    />
  )
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger }
