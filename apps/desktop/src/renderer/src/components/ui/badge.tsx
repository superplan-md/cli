import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium tracking-[0.01em]',
  {
    variants: {
      variant: {
        default: 'border-border/70 bg-secondary/60 text-secondary-foreground',
        secondary: 'border-border/60 bg-white/[0.04] text-muted-foreground',
        outline: 'border-border/60 bg-transparent text-foreground/72',
        success: 'border-emerald-400/16 bg-emerald-400/10 text-emerald-200',
        active: 'border-sky-400/18 bg-sky-400/10 text-sky-200'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge }
